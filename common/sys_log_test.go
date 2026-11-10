package common

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLogStartupSuccessWithHostname(t *testing.T) {
	var output bytes.Buffer

	LogWriterMu.Lock()
	previousWriter := gin.DefaultWriter
	gin.DefaultWriter = &output
	LogWriterMu.Unlock()
	t.Cleanup(func() {
		LogWriterMu.Lock()
		gin.DefaultWriter = previousWriter
		LogWriterMu.Unlock()
	})

	LogStartupSuccess(time.Now(), "localhost", "3000")

	logOutput := output.String()
	require.Contains(t, logOutput, "http://localhost:3000/")
	assert.Equal(t, 1, strings.Count(logOutput, "http://"))
}
