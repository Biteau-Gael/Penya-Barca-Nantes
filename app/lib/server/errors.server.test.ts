import { describe, it, expect } from "vitest";
import { AppError } from "./errors.server";

describe("AppError", () => {
  it("should create an error with code, message, and status", () => {
    const error = new AppError("PRONO_DEADLINE_PASSED", "La deadline est depassee", 400);

    expect(error.code).toBe("PRONO_DEADLINE_PASSED");
    expect(error.message).toBe("La deadline est depassee");
    expect(error.status).toBe(400);
    expect(error.name).toBe("AppError");
  });

  it("should be an instance of Error", () => {
    const error = new AppError("UNAUTHORIZED_ROLE", "Acces non autorise", 403);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
  });

  it("should have a stack trace", () => {
    const error = new AppError("INTERNAL", "Erreur interne", 500);

    expect(error.stack).toBeDefined();
  });
});
