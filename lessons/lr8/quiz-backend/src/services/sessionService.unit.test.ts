import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, txMock, scoreMultipleSelectMock } = vi.hoisted(() => {
  const tx = {
    session: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    question: {
      findUnique: vi.fn(),
    },
    answer: {
      create: vi.fn(),
    },
  };

  return {
    txMock: tx,
    prismaMock: {
      $transaction: vi.fn(),
    },
    scoreMultipleSelectMock: vi.fn(),
  };
});

vi.mock("../db/client.js", () => ({
  prisma: prismaMock,
}));

vi.mock("./scoringService.js", () => ({
  scoringService: {
    scoreMultipleSelect: scoreMultipleSelectMock,
  },
}));

import { SessionService } from "./sessionService.js";

describe("SessionService (unit)", () => {
  const service = new SessionService();

  beforeEach(() => {
    txMock.session.findUnique.mockReset();
    txMock.session.update.mockReset();
    txMock.question.findUnique.mockReset();
    txMock.answer.create.mockReset();
    scoreMultipleSelectMock.mockReset();
    prismaMock.$transaction.mockReset();
    prismaMock.$transaction.mockImplementation(async (callback) => callback(txMock));
  });

  it("throws 404 when session is not found", async () => {
    txMock.session.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.submitAnswer("session-id", "question-id", ["A"]),
    ).rejects.toMatchObject({
      message: "Session not found",
      statusCode: 404,
    });

    expect(txMock.question.findUnique).not.toHaveBeenCalled();
  });

  it("scores multiple-select answer and persists result", async () => {
    const nowPlusOneHour = new Date(Date.now() + 60 * 60 * 1000);

    txMock.session.findUnique.mockResolvedValueOnce({
      id: "session-id",
      userId: "user-id",
      status: "in_progress",
      score: null,
      startedAt: new Date(),
      expiresAt: nowPlusOneHour,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    txMock.question.findUnique.mockResolvedValueOnce({
      id: "question-id",
      text: "Q",
      type: "multiple-select",
      categoryId: "category-id",
      correctAnswer: ["A", "C"],
      points: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    scoreMultipleSelectMock.mockReturnValueOnce(1.5);

    const createdAnswer = {
      id: "answer-id",
      sessionId: "session-id",
      questionId: "question-id",
      userAnswer: ["A", "B"],
      score: 1.5,
      isCorrect: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    txMock.answer.create.mockResolvedValueOnce(createdAnswer);

    const result = await service.submitAnswer("session-id", "question-id", ["A", "B"]);

    expect(scoreMultipleSelectMock).toHaveBeenCalledWith(["A", "C"], ["A", "B"]);
    expect(txMock.answer.create).toHaveBeenCalledWith({
      data: {
        sessionId: "session-id",
        questionId: "question-id",
        userAnswer: ["A", "B"],
        score: 1.5,
        isCorrect: false,
      },
    });
    expect(result).toEqual(createdAnswer);
  });

  it("submits session and calculates total score from scored answers", async () => {
    const nowPlusOneHour = new Date(Date.now() + 60 * 60 * 1000);

    txMock.session.findUnique.mockResolvedValueOnce({
      id: "session-id",
      userId: "user-id",
      status: "in_progress",
      score: null,
      startedAt: new Date(),
      expiresAt: nowPlusOneHour,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      answers: [{ score: 1.5 }, { score: 2 }, { score: null }],
    });

    txMock.session.update.mockResolvedValueOnce({
      id: "session-id",
      userId: "user-id",
      status: "completed",
      score: 3.5,
      startedAt: new Date(),
      expiresAt: nowPlusOneHour,
      completedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      answers: [],
    });

    await service.submitSession("session-id");

    expect(txMock.session.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "session-id" },
        data: expect.objectContaining({
          status: "completed",
          score: 3.5,
        }),
      }),
    );
  });
});
