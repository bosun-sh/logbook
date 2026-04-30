package logbook

func EstimateFromKTokens(kTokens int) (int, error) {
	if kTokens <= 0 {
		return 0, TaskError{Tag: "validation_error", Message: "predicted kilotokens must be positive"}
	}
	if kTokens > 20 {
		return 0, TaskError{Tag: "validation_error", Message: "predicted kilotokens exceed maximum allowed"}
	}
	ratio := 20.0 / 8.0
	scaled := float64(kTokens) / ratio
	return nearestFib(scaled), nil
}

func ValidateFibonacci(n int) error {
	if n <= 0 {
		return TaskError{Tag: "validation_error", Message: "estimation must be a Fibonacci number"}
	}
	five := 5 * n * n
	if isPerfectSquare(five+4) || isPerfectSquare(five-4) {
		return nil
	}
	return TaskError{Tag: "validation_error", Message: "estimation must be a Fibonacci number"}
}

func isPerfectSquare(n int) bool {
	if n < 0 {
		return false
	}
	r := int64Sqrt(int64(n))
	return r*r == int64(n)
}

func int64Sqrt(n int64) int64 {
	if n <= 0 {
		return 0
	}
	x := n
	y := (x + 1) / 2
	for y < x {
		x = y
		y = (x + n/x) / 2
	}
	return x
}
