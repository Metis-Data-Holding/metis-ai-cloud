package wsmanager

import (
	"context"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testCloseConcurrencyLimit = 32

func resetRegistryForTest() {
	mu.Lock()
	defer mu.Unlock()
	registry = map[int]map[uint64]*entry{}
	nextID = 0
}

func TestCloseChannelClosesRegisteredConnectionsOnce(t *testing.T) {
	resetRegistryForTest()

	var mu sync.Mutex
	calls := 0
	Register(10, KindRealtime, func(reason string) {
		mu.Lock()
		defer mu.Unlock()
		require.Equal(t, "test reason", reason, "close callback should receive the provided reason")
		calls++
	})
	Register(10, KindResponses, func(reason string) {
		mu.Lock()
		defer mu.Unlock()
		calls++
	})

	require.Equal(t, 2, CloseChannel(10, "test reason"), "CloseChannel should close every registered connection for the channel")
	require.Equal(t, 0, CloseChannel(10, "test reason"), "CloseChannel should not close already removed connections")

	mu.Lock()
	defer mu.Unlock()
	assert.Equal(t, 2, calls, "all registered close callbacks should be called once")
}

func TestCloseChannelDoesNotCloseOtherChannels(t *testing.T) {
	resetRegistryForTest()

	calls := map[int]int{}
	Register(10, KindRealtime, func(reason string) {
		calls[10]++
	})
	Register(20, KindRealtime, func(reason string) {
		calls[20]++
	})

	require.Equal(t, 1, CloseChannel(10, "test"), "CloseChannel should only close the requested channel")
	assert.Equal(t, 1, calls[10], "requested channel callback should run")
	assert.Equal(t, 0, calls[20], "other channel callback should not run")
}

func TestUnregisterPreventsClose(t *testing.T) {
	resetRegistryForTest()

	calls := 0
	unregister := Register(10, KindRealtime, func(reason string) {
		calls++
	})
	unregister()

	require.Equal(t, 0, CloseChannel(10, "test"), "unregistered connections should not be closed")
	assert.Equal(t, 0, calls, "unregistered close callback should not run")
}

func TestRegisteredCloseIsIdempotent(t *testing.T) {
	resetRegistryForTest()

	calls := 0
	Register(10, KindRealtime, func(reason string) {
		calls++
	})

	mu.Lock()
	var registered *entry
	for _, e := range registry[10] {
		registered = e
	}
	mu.Unlock()
	require.NotNil(t, registered, "registered entry should exist")

	registered.close("test")
	registered.close("test")
	assert.Equal(t, 1, calls, "registered close callback should be idempotent")
}

func TestCloseChannelsBoundsCallbackConcurrencyAndWaits(t *testing.T) {
	resetRegistryForTest()

	release := make(chan struct{})
	started := make(chan struct{}, testCloseConcurrencyLimit+1)
	var current atomic.Int32
	var peak atomic.Int32
	for range testCloseConcurrencyLimit + 1 {
		Register(10, KindRealtime, func(string) {
			value := current.Add(1)
			for {
				previous := peak.Load()
				if value <= previous || peak.CompareAndSwap(previous, value) {
					break
				}
			}
			started <- struct{}{}
			<-release
			current.Add(-1)
		})
	}

	done := make(chan struct{})
	var closed atomic.Int32
	go func() {
		closed.Store(int32(CloseChannel(10, "test")))
		close(done)
	}()
	var releaseOnce sync.Once
	releaseAll := func() { releaseOnce.Do(func() { close(release) }) }
	t.Cleanup(func() {
		releaseAll()
		<-done
	})

	for range testCloseConcurrencyLimit {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("CloseChannels did not start the bounded set of callbacks")
		}
	}
	select {
	case <-started:
		t.Fatal("CloseChannels exceeded its callback concurrency limit")
	default:
	}
	select {
	case <-done:
		t.Fatal("CloseChannels returned before callbacks completed")
	default:
	}
	releaseAll()
	<-done

	assert.Equal(t, int32(testCloseConcurrencyLimit+1), closed.Load())
	assert.Equal(t, int32(testCloseConcurrencyLimit), peak.Load())
}

func TestCloseChannelsRecoversCallbackPanic(t *testing.T) {
	resetRegistryForTest()

	var ordinaryCalls atomic.Int32
	Register(10, KindRealtime, func(string) {
		panic("sensitive callback details")
	})
	Register(10, KindResponses, func(string) {
		ordinaryCalls.Add(1)
	})

	assert.Equal(t, 2, CloseChannel(10, "test"))
	assert.Equal(t, int32(1), ordinaryCalls.Load())
}

func TestPublishCloseChannelsNoopsWhenRedisDisabled(t *testing.T) {
	resetRegistryForTest()

	oldEnabled := common.RedisEnabled
	oldRDB := common.RDB
	common.RedisEnabled = false
	common.RDB = nil
	defer func() {
		common.RedisEnabled = oldEnabled
		common.RDB = oldRDB
	}()

	require.NoError(t, PublishCloseChannels(context.Background(), []int{10}, "test"), "publishing should no-op without Redis")
}

func TestRedisChannelCloseEventsStayWithinDatabase(t *testing.T) {
	resetRegistryForTest()
	previousEnabled, previousClient := common.RedisEnabled, common.RDB
	t.Cleanup(func() {
		common.RedisEnabled, common.RDB = previousEnabled, previousClient
		resetRegistryForTest()
	})
	address := os.Getenv("TEST_WS_MANAGER_REDIS_ADDR")
	if address == "" {
		address = miniredis.RunT(t).Addr()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	localPublisher := redis.NewClient(&redis.Options{Addr: address, DB: 0})
	localSubscriber := redis.NewClient(&redis.Options{Addr: address, DB: 0})
	otherPublisher := redis.NewClient(&redis.Options{Addr: address, DB: 1})
	for _, client := range []*redis.Client{localPublisher, localSubscriber, otherPublisher} {
		require.NoError(t, client.Ping(ctx).Err())
		t.Cleanup(func() { require.NoError(t, client.Close()) })
	}
	if os.Getenv("TEST_WS_MANAGER_REDIS_ADDR") != "" {
		info, err := localPublisher.Info(ctx, "server").Result()
		require.NoError(t, err)
		for line := range strings.SplitSeq(info, "\r\n") {
			if strings.HasPrefix(line, "redis_version:") {
				t.Log(line)
			}
		}
	}
	pubsub := localSubscriber.Subscribe(ctx, channelCloseTopic(localSubscriber.Options().DB))
	t.Cleanup(func() { require.NoError(t, pubsub.Close()) })
	_, err := pubsub.Receive(ctx)
	require.NoError(t, err, "wait for subscription acknowledgement before publishing")
	otherPubsub := otherPublisher.Subscribe(ctx, channelCloseTopic(otherPublisher.Options().DB))
	t.Cleanup(func() { require.NoError(t, otherPubsub.Close()) })
	_, err = otherPubsub.Receive(ctx)
	require.NoError(t, err)

	closed := make(chan int, 2)
	Register(10, KindRealtime, func(string) { closed <- 10 })
	Register(20, KindResponses, func(string) { closed <- 20 })
	done := make(chan struct{})
	go func() {
		defer close(done)
		receiveChannelCloseEvents(ctx, pubsub.Channel(), "receiving-node")
	}()
	t.Cleanup(func() {
		cancel()
		<-done
	})

	common.RedisEnabled, common.RDB = true, otherPublisher
	require.NoError(t, PublishCloseChannels(ctx, []int{10}, "other database"))
	otherEvent, err := otherPubsub.ReceiveMessage(ctx)
	require.NoError(t, err)
	var event closeEvent
	require.NoError(t, common.Unmarshal([]byte(otherEvent.Payload), &event))
	assert.Equal(t, []int{10}, event.ChannelIDs)
	assert.Equal(t, "other database", event.Reason)
	// The old global topic must not affect a namespaced receiver either.
	require.NoError(t, localPublisher.Publish(ctx, redisChannel, otherEvent.Payload).Err())

	common.RDB = localPublisher
	require.NoError(t, PublishCloseChannels(ctx, []int{20}, "same database"))
	select {
	case channelID := <-closed:
		assert.Equal(t, 20, channelID, "only the same-database broadcast may close a local connection")
	case <-ctx.Done():
		t.Fatal("same-database broadcast did not close its connection")
	}
	// Redis processes the preceding publications before this successful one,
	// so the retained registration proves isolation without sleeps or polling.
	assert.Equal(t, 1, CloseChannel(10, "test cleanup"))
}
