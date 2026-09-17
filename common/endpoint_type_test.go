package common

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/assert"
)

func TestGetEndpointTypesByChannelTypeTreatsDoubaoVideoAsVideoOnly(t *testing.T) {
	assert.Equal(t,
		[]constant.EndpointType{constant.EndpointTypeOpenAIVideo},
		GetEndpointTypesByChannelType(constant.ChannelTypeDoubaoVideo, "dreamina-seedance-2-0-260128"),
	)
}

func TestGetEndpointTypesByChannelTypeDoesNotTreatTaskPluginAsChat(t *testing.T) {
	assert.Empty(t, GetEndpointTypesByChannelType(constant.ChannelTypeTaskPlugin, "minimax-h3-fl2va"))
	assert.Empty(t, GetEndpointTypesByChannelType(constant.ChannelTypeTaskPlugin, "dall-e-3"))
}
