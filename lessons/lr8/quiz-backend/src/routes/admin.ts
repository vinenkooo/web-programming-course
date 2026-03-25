import { Prisma } from "@prisma/client";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { requireAdmin, type AdminVariables } from "../middleware/admin.js";
import {
  BatchQuestionsSchema,
  GradeAnswerParamSchema,
  GradeSchema,
  PaginationQuerySchema,
  QuestionParamSchema,
  QuestionSchema,
  QuestionUpdateSchema,
  StudentParamSchema,
} from "../utils/validation.js";

export const admin = new Hono<{ Variables: AdminVariables }>();

admin.use("*", requireAdmin);

admin.get("/questions", async (c) => {
  const questions = await prisma.question.findMany({
    select: {
      id: true,
      text: true,
      type: true,
      points: true,
      createdAt: true,
      updatedAt: true,
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      _count: {
        select: {
          answers: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return c.json({ questions });
});

admin.post("/questions", async (c) => {
  try {
    const body = await c.req.json();
    const data = QuestionSchema.parse(body);

    const question = await prisma.question.create({
      data: {
        text: data.text,
        type: data.type,
        categoryId: data.categoryId,
        correctAnswer: data.correctAnswer,
        points: data.points,
      },
    });

    return c.json({ question }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.flatten() }, 400);
    }

    if ((error as any)?.code === "P2003") {
      return c.json({ error: "Category not found" }, 400);
    }

    return c.json({ error: "Internal Server Error" }, 500);
  }
});

admin.post("/questions/batch", async (c) => {
  try {
    const body = await c.req.json();
    const data = BatchQuestionsSchema.parse(body);

    const result = await prisma.question.createMany({
      data: data.questions.map((q) => ({
        text: q.text,
        type: q.type,
        categoryId: q.categoryId,
        correctAnswer: q.correctAnswer,
        points: q.points,
      })),
    });

    return c.json({ createdCount: result.count }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.flatten() }, 400);
    }

    if ((error as any)?.code === "P2003") {
      return c.json({ error: "Category not found" }, 400);
    }

    return c.json({ error: "Internal Server Error" }, 500);
  }
});

admin.put("/questions/:id", async (c) => {
  try {
    const { id } = QuestionParamSchema.parse(c.req.param());
    const body = await c.req.json();
    const data = QuestionUpdateSchema.parse(body);

    const question = await prisma.question.update({
      where: { id },
      data,
    });

    return c.json({ question });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.flatten() }, 400);
    }

    if ((error as any)?.code === "P2025") {
      return c.json({ error: "Question not found" }, 404);
    }

    if ((error as any)?.code === "P2003") {
      return c.json({ error: "Category not found" }, 400);
    }

    return c.json({ error: "Internal Server Error" }, 500);
  }
});

admin.get("/answers/pending", async (c) => {
  try {
    const { page, limit } = PaginationQuerySchema.parse(c.req.query());
    const skip = (page - 1) * limit;

    const where = {
      score: null,
      question: { type: "essay" as const },
    };

    const [total, answers] = await prisma.$transaction([
      prisma.answer.count({ where }),
      prisma.answer.findMany({
        where,
        include: {
          question: {
            select: {
              id: true,
              text: true,
              type: true,
            },
          },
          session: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
        skip,
        take: limit,
      }),
    ]);

    return c.json({
      answers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.flatten() }, 400);
    }

    return c.json({ error: "Internal Server Error" }, 500);
  }
});

admin.post("/answers/:id/grade", async (c) => {
  try {
    const { id } = GradeAnswerParamSchema.parse(c.req.param());
    const body = await c.req.json();
    const grade = GradeSchema.parse(body);

    const answer = await prisma.$transaction(async (tx: any) => {
      const existing = await tx.answer.findUnique({
        where: { id },
        include: {
          question: {
            select: {
              type: true,
            },
          },
        },
      });

      if (!existing) {
        throw new Error("Answer not found");
      }

      if (existing.question.type !== "essay") {
        throw new Error("Only essay answers can be graded manually");
      }

      const updated = await tx.answer.update({
        where: { id },
        data: {
          score: grade.points,
        },
      });

      const session = await tx.session.findUnique({
        where: { id: updated.sessionId },
        include: {
          answers: true,
        },
      });

      const allGraded = session?.answers.every((a: any) => a.score !== null) ?? false;
      if (session && allGraded) {
        const totalScore = session.answers.reduce((sum: any, a: any) => sum + (a.score ?? 0), 0);

        await tx.session.update({
          where: { id: session.id },
          data: {
            score: totalScore,
            status: "completed",
            completedAt: new Date(),
          },
        });
      }

      return updated;
    });

    return c.json({ answer });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.flatten() }, 400);
    }

    if (error instanceof Error && error.message === "Answer not found") {
      return c.json({ error: error.message }, 404);
    }

    if (error instanceof Error && error.message === "Only essay answers can be graded manually") {
      return c.json({ error: error.message }, 400);
    }

    return c.json({ error: "Internal Server Error" }, 500);
  }
});

admin.get("/students/:userId/stats", async (c) => {
  try {
    const { userId } = StudentParamSchema.parse(c.req.param());

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    const sessions = await prisma.session.findMany({
      where: { userId },
      select: {
        id: true,
        score: true,
        status: true,
        startedAt: true,
        _count: {
          select: {
            answers: true,
          },
        },
      },
      orderBy: { startedAt: "desc" },
    });

    const averageScore =
      sessions.length > 0
        ? sessions.reduce((sum: any, s: any) => sum + (s.score ?? 0), 0) / sessions.length
        : 0;

    return c.json({
      student: user,
      stats: {
        sessionCount: sessions.length,
        averageScore,
      },
      sessions,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.flatten() }, 400);
    }

    return c.json({ error: "Internal Server Error" }, 500);
  }
});

admin.get("/students", async (c) => {
  try {
    const { page, limit } = PaginationQuerySchema.parse(c.req.query());
    const skip = (page - 1) * limit;

    const [total, students] = await prisma.$transaction([
      prisma.user.count({ where: { role: "student" } }),
      prisma.user.findMany({
        where: { role: "student" },
        select: {
          id: true,
          email: true,
          name: true,
          sessions: {
            where: { score: { not: null } },
            select: { score: true },
          },
          _count: {
            select: {
              sessions: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    return c.json({
      students: students.map((s: any) => {
        const scores = s.sessions
          .map((session: any) => session.score)
          .filter((value: any) => value !== null);

        const averageScore =
          scores.length > 0
            ? scores.reduce((sum: any, value: any) => sum + value, 0) / scores.length
            : 0;

        return {
          id: s.id,
          email: s.email,
          name: s.name,
          sessionCount: s._count.sessions,
          averageScore,
        };
      }),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.flatten() }, 400);
    }

    return c.json({ error: "Internal Server Error" }, 500);
  }
});
