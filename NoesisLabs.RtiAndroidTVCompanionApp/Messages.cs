using NoesisLabs.RtiAndroidTVCompanionApp.Events;

namespace NoesisLabs.RtiAndroidTVCompanionApp.Messages
{
    public record MessageWrapper<T>(int DeviceIndex, T Payload)
    {
        public string PayloadType => typeof(T).Name;
    }

    public record MediaStateChanged()
    {
        public string? AppName { get; init; }
        public string? PackageName { get; init; }
        public Metadata? Metadata { get; init; }
    }

    public record PlaybackStateChanged()
    {
        public PlaybackState? PlaybackState { get; init; }
    }

    public record ServiceErrorEncountered()
    {
        public string ErrorMessage { get; init; }
    }
}