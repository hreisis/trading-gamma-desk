/** Fifteen strikes, both sides: at most 30 contract credits per symbol. */
export function currentGammaSample(spot: number, session: string) {
  if (!Number.isFinite(spot) || spot <= 0) throw new Error("Invalid sample spot");
  const center = Math.round(spot / 5) * 5;
  const day = new Date(`${session}T12:00:00Z`);
  const days = (5 - day.getUTCDay() + 7) % 7 || 7;
  day.setUTCDate(day.getUTCDate() + days);
  return { strikeMin: center - 35, strikeMax: center + 35, expiration: day.toISOString().slice(0, 10) };
}
