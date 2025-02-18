namespace NoesisLabs.RtiAndroidTVCompanionApp
{
    public static class Constants
    {
        public const int DelayBetweenMessages = 1000;
        public const int ServiceRunningNotificationId = 4368;
        public const int IconWidth = 200;
        public const int IconHeight = 200;
        public const string DefaultNotificationChannelId = "com.noesislabs.rtiandroidtvcompanion.DEFAULT";


        public const string HostIpKey = "hostip";
        public const string HostPortKey = "hostport";
        public const string DeviceIndexKey = "deviceindex";
        public const string ServiceStartedKey = "hasservicebeenstarted";

        public const string SyncIntentAction = "com.noesislabs.rtiandroidtvcompanion.SYNC";
        public const string ConfigIntentAction = "com.noesislabs.rtiandroidtvcompanion.CONFIG";
        public const string StartServiceAction = "com.noesislabs.rtiandroidtvcompanion.START_SERVICE";
        public const string StopServiceAction = "com.noesislabs.rtiandroidtvcompanion.STOP_SERVICE";
        public const string MainActivityAction = "com.noesislabs.rtiandroidtvcompanion.MAIN_ACTIVITY";

        public const string AppLinkDataScheme = "https";
        public const string AppLinkDataHost = "rtiandroidtvcompanion.noesislabs.com";
    }
}