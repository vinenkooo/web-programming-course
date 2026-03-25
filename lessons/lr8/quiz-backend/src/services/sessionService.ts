import { Prisma } from "@prisma/client";
import { prisma } from "../db/client.js";
import { scoringService } from "./scoringService.js";

export class SessionServiceError extends Error {
  constructor(
    message:
      | "Session not found"
      | "Question not found"
      | "Session is not active"
      | "Session expired"
      | "Invalid answer format"
      | "Answer already submitted",
    public readonly statusCode: 400 | 404 | 409,
  ) {
    super(message);
    this.name = "SessionServiceError";
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export class SessionService {
  async submitAnswer(sessionId: string, questionId: string, userAnswer: string | string[]) {
    return prisma.$transaction(async (tx: any) => {
      const session = await tx.session.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        throw new SessionServiceError("Session not found", 404);
      }

      if (session.status !== "in_progress") {
        throw new SessionServiceError("Session is not active", 409);
      }

      if (session.expiresAt < new Date()) {
        await tx.session.update({
          where: { id: sessionId },
          data: { status: "expired" },
        });
        throw new SessionServiceError("Session expired", 409);
      }

      const question = await tx.question.findUnique({
        where: { id: questionId },
      });

      if (!question) {
        throw new SessionServiceError("Question not found", 404);
      }

      let score: number | null = null;
      let isCorrect: boolean | null = null;

      if (question.type === "multiple-select") {
        if (!isStringArray(userAnswer)) {
          throw new SessionServiceError("Invalid answer format", 400);
        }

        if (!isStringArray(question.correctAnswer)) {
          throw new SessionServiceError("Invalid answer format", 400);
        }

        score = scoringService.scoreMultipleSelect(question.correctAnswer, userAnswer);
        const correctSet = new Set(question.correctAnswer);
        const studentSet = new Set(userAnswer);
        isCorrect =
          studentSet.size === correctSet.size &&
          Array.from(studentSet).every((answer) => correctSet.has(answer));
      }

      try {
        return await tx.answer.create({
          data: {
            sessionId,
            questionId,
            userAnswer: userAnswer as any,
            score,
            isCorrect,
          },
        });
      } catch (error) {
        if ((error as any)?.code === "P2002") {
          throw new SessionServiceError("Answer already submitted", 409);
        }

        throw error;
      }
    });
  }

  async submitSession(sessionId: string) {
    return prisma.$transaction(async (tx: any) => {
      const session = await tx.session.findUnique({
        where: { id: sessionId },
        include: {
          answers: true,
        },
      });

      if (!session) {
        throw new SessionServiceError("Session not found", 404);
      }

      if (session.status !== "in_progress") {
        throw new SessionServiceError("Session is not active", 409);
      }

      if (session.expiresAt < new Date()) {
        await tx.session.update({
          where: { id: sessionId },
          data: { status: "expired" },
        });
        throw new SessionServiceError("Session expired", 409);
      }

      const totalScore = session.answers
        .filter((answer: { score: number | null }) => answer.score !== null)
        .reduce((sum: number, answer: { score: number | null }) => sum + (answer.score ?? 0), 0);

      return tx.session.update({
        where: { id: sessionId },
        data: {
          status: "completed",
          score: totalScore,
          completedAt: new Date(),
        },
        include: {
          answers: true,
        },
      });
    });
  }
}

export const sessionService = new SessionService();
