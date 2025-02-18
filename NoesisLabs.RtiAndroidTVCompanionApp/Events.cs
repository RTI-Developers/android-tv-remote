using Android.Graphics;
using Android.Media;
using Android.Media.Session;
using System;
using System.IO;

namespace NoesisLabs.RtiAndroidTVCompanionApp.Events
{
    public interface IEvent { }

    public record ActiveMediaControllerChangedEvent() : IEvent
    {
        public string PackageName { get; init; }
        public Metadata Metadata { get; init; }
        public PlaybackState? PlaybackState { get; init; }
    }
    public record ActiveMediaControllerPolledEvent() : IEvent
    {
        public string PackageName { get; init; }
        public Metadata Metadata { get; init; }
        public PlaybackState? PlaybackState { get; init; }
    }

    public record NoActiveMediaControllerEvent() : IEvent;
    public record MetadataChangedEvent() : IEvent
    {
        public Metadata Metadata { get; init; }
    }
    public record PlaybackStateChangedEvent() : IEvent
    {
        public PlaybackState? PlaybackState { get; init; }
    }

    public record Metadata
    {
        public string? Title { get; init; }
        public string? DisplayTitle { get; init; }
        public string? Album { get; init; }
        public string? Artist { get; init; }
        public string? MediaUri { get; init; }
        public string? DisplayIconUri { get; init; }
        public string? AlbumArt { get; init; }
        public string? AlbumArtUri { get; init; }
        public long? Duration { get; init; }

        public static Metadata FromMediaMetadata(MediaMetadata mediaMetadata)
        {
            var albumArt = default(string?);

            var albumArtBitmap = mediaMetadata?.GetBitmap(MediaMetadata.MetadataKeyAlbumArt);
            if (albumArtBitmap != null)
            {
                var scaledAlbumArtBitmap = albumArtBitmap.ScaleToFitCenter(Constants.IconWidth, Constants.IconHeight);
                using var stream = new MemoryStream();
                scaledAlbumArtBitmap.Compress(Bitmap.CompressFormat.Jpeg, 70, stream);
                albumArt = Convert.ToBase64String(stream.ToArray());
            }

            return new Metadata
            {
                Title = mediaMetadata?.Description?.Title,
                DisplayTitle = mediaMetadata?.GetString(MediaMetadata.MetadataKeyDisplayTitle),
                Album = mediaMetadata?.GetString(MediaMetadata.MetadataKeyAlbum),
                Artist = mediaMetadata?.GetString(MediaMetadata.MetadataKeyArtist),
                MediaUri = mediaMetadata?.Description?.MediaUri?.ToString(),
                DisplayIconUri = mediaMetadata?.GetString(MediaMetadata.MetadataKeyDisplayIconUri),
                AlbumArt = albumArt,
                AlbumArtUri = mediaMetadata?.GetString(MediaMetadata.MetadataKeyAlbumArtUri),
                Duration = mediaMetadata?.GetLong(MediaMetadata.MetadataKeyDuration)
            };
        }
    }

    public record PlaybackState
    {
        public PlaybackStateCode State { get; set; }
        public long Position { get; set; }
        public float PlaybackSpeed { get; set; }

        public static PlaybackState FromPlaybackState(Android.Media.Session.PlaybackState playbackState)
        {
            if (playbackState == null) return null;

            return new PlaybackState
            {
                State = playbackState.State,
                Position = playbackState.Position,
                PlaybackSpeed = playbackState.PlaybackSpeed,
            };
        }
    }
}