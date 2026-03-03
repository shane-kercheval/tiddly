package output

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
)

// TTYDetector checks if a file descriptor is a terminal.
type TTYDetector interface {
	IsTerminal(fd uintptr) bool
}

// Format represents an output format.
type Format string

const (
	FormatText Format = "text"
	FormatJSON Format = "json"
)

// Formatter handles structured output in text or JSON format.
type Formatter struct {
	Format Format
	Writer io.Writer
	ErrW   io.Writer
}

// New creates a Formatter with the given format, writing to stdout/stderr.
func New(format string) *Formatter {
	f := FormatText
	if format == "json" {
		f = FormatJSON
	}
	return &Formatter{
		Format: f,
		Writer: os.Stdout,
		ErrW:   os.Stderr,
	}
}

// PrintJSON writes v as indented JSON.
func (f *Formatter) PrintJSON(v any) error {
	enc := json.NewEncoder(f.Writer)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

// Println writes a line to the output writer.
func (f *Formatter) Println(a ...any) {
	fmt.Fprintln(f.Writer, a...)
}

// Printf writes a formatted string to the output writer.
func (f *Formatter) Printf(format string, a ...any) {
	fmt.Fprintf(f.Writer, format, a...)
}

// Errorf writes a formatted string to stderr.
func (f *Formatter) Errorf(format string, a ...any) {
	fmt.Fprintf(f.ErrW, format, a...)
}
