const HAIKU_MODEL = "claude-haiku-4-5-20251001"
const SONNET_MODEL = "claude-sonnet-4-6"

export const selectAssignedModel = (predictedKTokens: number): string =>
  predictedKTokens <= 5 ? HAIKU_MODEL : SONNET_MODEL
