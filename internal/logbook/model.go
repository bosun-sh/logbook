package logbook

const (
	assignedHaikuModel  = "claude-haiku-4-5-20251001"
	assignedSonnetModel = "claude-sonnet-4-6"
)

func assignedModelForKTokens(kTokens int) string {
	if kTokens <= 5 {
		return assignedHaikuModel
	}
	return assignedSonnetModel
}
