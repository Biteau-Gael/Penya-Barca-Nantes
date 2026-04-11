export interface PointsConfig {
  exactScore: number;
  correctResult: number;
  wrongResult: number;
}

export const POINTS_SCHEMES: Record<string, PointsConfig> = {
  standard: { exactScore: 3, correctResult: 1, wrongResult: 0 },
  strict: { exactScore: 5, correctResult: 1, wrongResult: 0 },
  souple: { exactScore: 3, correctResult: 2, wrongResult: 1 },
};

function getMatchResult(home: number, away: number): "home" | "draw" | "away" {
  if (home > away) return "home";
  if (home < away) return "away";
  return "draw";
}

export function calculatePoints(
  predictedHome: number,
  predictedAway: number,
  actualHome: number,
  actualAway: number,
  scheme: string = "standard",
): number {
  const config = POINTS_SCHEMES[scheme] ?? POINTS_SCHEMES.standard;

  // Score exact
  if (predictedHome === actualHome && predictedAway === actualAway) {
    return config.exactScore;
  }

  // Bon résultat
  const predictedResult = getMatchResult(predictedHome, predictedAway);
  const actualResult = getMatchResult(actualHome, actualAway);

  if (predictedResult === actualResult) {
    return config.correctResult;
  }

  return config.wrongResult;
}
