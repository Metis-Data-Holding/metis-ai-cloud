package controller

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
)

func TestVideoReferenceCleanupHandlerSchedule(t *testing.T) {
	handler := videoReferenceCleanupHandler{}

	assert.Equal(t, model.SystemTaskTypeVideoReferenceCleanup, handler.Type())
	assert.True(t, handler.Enabled())
	assert.Equal(t, time.Hour, handler.Interval())
	assert.Nil(t, handler.NewPayload())
}
