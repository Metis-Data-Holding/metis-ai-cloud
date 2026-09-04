package service

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSaveVideoReferenceAcceptsMP4AndBuildsSignedURL(t *testing.T) {
	dir := t.TempDir()
	previousSecret := common.CryptoSecret
	previousAddress := system_setting.ServerAddress
	previousPublicAddress := system_setting.TaskPublicAddress
	common.CryptoSecret = "video-reference-test-secret"
	system_setting.ServerAddress = "https://many-models.example"
	system_setting.TaskPublicAddress = ""
	t.Cleanup(func() {
		common.CryptoSecret = previousSecret
		system_setting.ServerAddress = previousAddress
		system_setting.TaskPublicAddress = previousPublicAddress
	})

	mp4 := append([]byte{0, 0, 0, 24}, []byte("ftypisom00000000")...)
	result, err := SaveVideoReference(strings.NewReader(string(mp4)), "clip.mp4", int64(len(mp4)), VideoReferenceSaveOptions{
		Directory: dir,
		Now:       time.Unix(1_700_000_000, 0),
		NewID:     func() (string, error) { return "abcdefghijklmnopqrstuvwx", nil },
	})

	require.NoError(t, err)
	assert.Equal(t, "abcdefghijklmnopqrstuvwx.mp4", result.ID)
	assert.Equal(t, "video/mp4", result.ContentType)
	assert.Equal(t, int64(len(mp4)), result.Size)
	assert.Contains(t, result.URL, "/v1/video-reference-files/abcdefghijklmnopqrstuvwx.mp4/content?")
	assert.Contains(t, result.URL, "expires=1700180000")
	_, err = os.Stat(filepath.Join(dir, result.ID))
	require.NoError(t, err)
	_, err = os.Stat(filepath.Join(dir, result.ID+".uploading"))
	assert.True(t, errors.Is(err, os.ErrNotExist))
}

func TestSaveVideoReferenceRejectsUnsupportedAndOversizedContent(t *testing.T) {
	dir := t.TempDir()
	options := VideoReferenceSaveOptions{
		Directory: dir,
		Now:       time.Unix(1_700_000_000, 0),
		NewID:     func() (string, error) { return "abcdefghijklmnopqrstuvwx", nil },
		MaxBytes:  8,
	}

	_, err := SaveVideoReference(bytes.NewReader([]byte("not-video")), "clip.mp4", 9, options)
	assert.ErrorIs(t, err, ErrVideoReferenceTooLarge)

	options.MaxBytes = 100
	_, err = SaveVideoReference(bytes.NewReader([]byte("not-video")), "clip.mp4", 0, options)
	assert.ErrorIs(t, err, ErrVideoReferenceUnsupported)

	entries, readErr := os.ReadDir(dir)
	require.NoError(t, readErr)
	assert.Empty(t, entries)
}

func TestVerifyVideoReferenceAccessRejectsExpiryAndTampering(t *testing.T) {
	previousSecret := common.CryptoSecret
	common.CryptoSecret = "video-reference-test-secret"
	t.Cleanup(func() { common.CryptoSecret = previousSecret })

	expires := time.Unix(1_700_180_000, 0)
	access, err := IssueVideoReferenceAccess("abcdefghijklmnopqrstuvwx.mp4", expires)
	require.NoError(t, err)

	assert.True(t, VerifyVideoReferenceAccess(access, "abcdefghijklmnopqrstuvwx.mp4", expires.Unix(), time.Unix(1_700_000_000, 0)))
	assert.False(t, VerifyVideoReferenceAccess(access, "abcdefghijklmnopqrstuvwy.mp4", expires.Unix(), time.Unix(1_700_000_000, 0)))
	assert.False(t, VerifyVideoReferenceAccess(access, "abcdefghijklmnopqrstuvwx.mp4", expires.Unix(), expires.Add(time.Second)))
	assert.False(t, VerifyVideoReferenceAccess(access+"x", "abcdefghijklmnopqrstuvwx.mp4", expires.Unix(), time.Unix(1_700_000_000, 0)))
}

func TestOpenVideoReferenceRejectsSymbolicLinks(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "target.mp4")
	require.NoError(t, os.WriteFile(target, []byte("video"), 0o600))
	fileID := "abcdefghijklmnopqrstuvwx.mp4"
	require.NoError(t, os.Symlink(target, filepath.Join(dir, fileID)))

	file, _, err := OpenVideoReference(dir, fileID)

	assert.Nil(t, file)
	assert.ErrorIs(t, err, ErrVideoReferenceInvalid)
}

func TestCleanupVideoReferenceUploadsUsesSeparateTTLs(t *testing.T) {
	dir := t.TempDir()
	now := time.Unix(1_700_000_000, 0)
	write := func(name string, age time.Duration) {
		require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte("1234"), 0o600))
		stamp := now.Add(-age)
		require.NoError(t, os.Chtimes(filepath.Join(dir, name), stamp, stamp))
	}
	write("oldoldoldoldoldoldoldold.mp4", 51*time.Hour)
	write("freshfreshfreshfreshfresh1.mov", 49*time.Hour)
	write("staleuploadstaleupload12.mp4.uploading", 2*time.Hour)
	write("freshuploadfreshupload12.mov.uploading", 30*time.Minute)
	write("unrelated.txt", 100*time.Hour)

	result, err := CleanupVideoReferenceUploads(dir, now, nil)

	require.NoError(t, err)
	assert.Equal(t, 5, result.Scanned)
	assert.Equal(t, 2, result.Deleted)
	assert.Equal(t, int64(8), result.FreedBytes)
	assert.Zero(t, result.Failed)
	_, err = os.Stat(filepath.Join(dir, "freshfreshfreshfreshfresh1.mov"))
	require.NoError(t, err)
	_, err = os.Stat(filepath.Join(dir, "unrelated.txt"))
	require.NoError(t, err)
}

func TestCleanupVideoReferenceUploadsReportsScannedProgress(t *testing.T) {
	dir := t.TempDir()
	now := time.Unix(1_700_000_000, 0)
	for _, name := range []string{
		"oldoldoldoldoldoldoldold.mp4",
		"freshfreshfreshfreshfresh1.mov",
		"unrelated.txt",
	} {
		require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte("1234"), 0o600))
	}
	require.NoError(t, os.Chtimes(
		filepath.Join(dir, "oldoldoldoldoldoldoldold.mp4"),
		now.Add(-51*time.Hour),
		now.Add(-51*time.Hour),
	))

	var progress [][2]int
	result, err := CleanupVideoReferenceUploads(dir, now, func(processed, total int) {
		progress = append(progress, [2]int{processed, total})
	})

	require.NoError(t, err)
	assert.Equal(t, [][2]int{{0, 3}, {1, 3}, {2, 3}, {3, 3}}, progress)
	assert.Equal(t, 3, result.Scanned)
	assert.Equal(t, 1, result.Deleted)
}

func TestCleanupVideoReferenceUploadsReportsCompletionForMissingDirectory(t *testing.T) {
	var progress [][2]int
	result, err := CleanupVideoReferenceUploads(filepath.Join(t.TempDir(), "missing"), time.Now(), func(processed, total int) {
		progress = append(progress, [2]int{processed, total})
	})

	require.NoError(t, err)
	assert.Equal(t, [][2]int{{0, 0}}, progress)
	assert.Zero(t, result.Scanned)
}
