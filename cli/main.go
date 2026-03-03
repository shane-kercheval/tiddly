package main

import (
	"os"

	"github.com/shane-kercheval/tiddly/cli/cmd"
)

func main() {
	if err := cmd.Execute(); err != nil {
		os.Exit(1)
	}
}
