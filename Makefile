SHELL := /bin/sh

.PHONY: release build clean help

help:
	@echo "Targets:"
	@echo "  release VERSION=x.y.z   Cross-compile both binaries for all platforms with embedded version"
	@echo "  build                   Cross-compile both binaries for all platforms (VERSION=dev)"
	@echo "  clean                   Remove dist/bin"

release:
ifndef VERSION
	$(error VERSION is required: make release VERSION=1.2.3)
endif
	VERSION=$(VERSION) ./scripts/build-binaries.sh
	@echo "Built logbook $(VERSION) binaries in dist/bin/"

build:
	./scripts/build-binaries.sh

clean:
	rm -rf dist/bin
