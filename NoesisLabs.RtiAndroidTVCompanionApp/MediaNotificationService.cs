using Android.App;
using Android.App.Usage;
using Android.Content;
using Android.Content.PM;
using Android.Graphics;
using Android.Graphics.Drawables;
using Android.Media.Session;
using Android.OS;
using Android.Service.Notification;
using AndroidX.Core.App;
using Microsoft.AppCenter.Crashes;
using NoesisLabs.RtiAndroidTVCompanionApp.Events;
using NoesisLabs.RtiAndroidTVCompanionApp.Messages;
using System;
using System.IO;
using System.Net.Sockets;
using System.Text.Json;

namespace NoesisLabs.RtiAndroidTVCompanionApp
{
    [Service(Label = "MediaNotificationService", Permission = "android.permission.BIND_NOTIFICATION_LISTENER_SERVICE", Exported = true)]
    [IntentFilter(new[] { "android.service.notification.NotificationListenerService" })]
    public class MediaNotificationService : NotificationListenerService
    {
        private ComponentName? _notificationListenerComponent;
        private MediaSessionManager? _mediaSessionManager;
        private UsageStatsManager? _usageStatsManager;
        private Handler? _mainHandler;
        private Action? _runnable;
        private bool _isStarted = false;
        private MediaStateChanged? _currentMediaState;
        private PlaybackStateChanged? _currentPlaybackState;
        private (string HostIp, int HostPort, int DeviceIndex)? _config;

        public override void OnCreate()
        {
            base.OnCreate();

            _notificationListenerComponent = new ComponentName(this, Java.Lang.Class.FromType(typeof(MediaNotificationService)));
            _mediaSessionManager = GetSystemService(Context.MediaSessionService) as MediaSessionManager;
            _usageStatsManager = GetSystemService(Context.UsageStatsService) as UsageStatsManager;
            _mainHandler = new Handler(Looper.MainLooper);
            _runnable = new Action(() =>
            {
                try
                {
                    var newState = GetCurrentState();

                    if (newState.MediaState != _currentMediaState)
                    {
                        SendMessage(_config.Value, new MessageWrapper<MediaStateChanged>(_config.Value.DeviceIndex, newState.MediaState));
                        _currentMediaState = newState.MediaState;
                    }

                    if (newState.PlaybackState != _currentPlaybackState)
                    {
                        SendMessage(_config.Value, new MessageWrapper<PlaybackStateChanged>(_config.Value.DeviceIndex, newState.PlaybackState));
                        _currentPlaybackState = newState.PlaybackState;
                    }
                }
                catch (Exception ex)
                {
                    Crashes.TrackError(ex);
                }

                _mainHandler.PostDelayed(_runnable, Constants.DelayBetweenMessages);
            });

            _currentMediaState = new();
            _currentPlaybackState = new();
        }

        public override StartCommandResult OnStartCommand(Intent intent, StartCommandFlags flags, int startId)
        {
            if (intent.Action?.Equals(Constants.StartServiceAction) ?? false)
            {
                RegisterForegroundService();
                UpdateConfig();

                if (_config != null && CheckPermissions())
                {
                    if (_isStarted)
                    {
                        SendMessage(_config.Value, new MessageWrapper<MediaStateChanged>(_config.Value.DeviceIndex, _currentMediaState));
                        SendMessage(_config.Value, new MessageWrapper<PlaybackStateChanged>(_config.Value.DeviceIndex, _currentPlaybackState));
                    }
                    else
                    {
                        _mainHandler.PostDelayed(_runnable, Constants.DelayBetweenMessages);
                        _isStarted = true;
                    }
                }
            }
            else if (intent.Action.Equals(Constants.StopServiceAction))
            {
                StopForeground(true);
                StopSelf();
                _isStarted = false;
            }

            return StartCommandResult.Sticky;
        }

        public override void OnDestroy()
        {
            // Remove the notification from the status bar.
            var notificationManager = (NotificationManager)GetSystemService(NotificationService);
            notificationManager.Cancel(Constants.ServiceRunningNotificationId);

            _isStarted = false;
            base.OnDestroy();
        }

        void UpdateConfig()
        {
            var prefs = AndroidX.Preference.PreferenceManager.GetDefaultSharedPreferences(this);
            var hostIp = prefs.GetString(Constants.HostIpKey, default);
            var hostPort = prefs.GetInt(Constants.HostPortKey, 0);
            var deviceIndex = prefs.GetInt(Constants.DeviceIndexKey, 0);

            if (!string.IsNullOrEmpty(hostIp) &&
                    hostPort > 0 &&
                    deviceIndex > 0)
            {
                _config = (hostIp, hostPort, deviceIndex);
            }
        }

        (MediaStateChanged MediaState, PlaybackStateChanged PlaybackState) GetCurrentState()
        {
            var mediaState = new MediaStateChanged {
                    AppName = default,
                    PackageName = default,
                    Metadata = default
                };
            var playbackState = new PlaybackStateChanged { PlaybackState = default };

            var activeMediaControllers = _mediaSessionManager.GetActiveSessions(_notificationListenerComponent);
            if ((activeMediaControllers?.Count ?? 0) > 0)
            {
                mediaState = mediaState with
                {
                    AppName = GetAppName(activeMediaControllers[0].PackageName),
                    PackageName = activeMediaControllers[0].PackageName,
                    Metadata = Metadata.FromMediaMetadata(activeMediaControllers[0].Metadata)
                };
                playbackState = playbackState with
                {
                    PlaybackState = Events.PlaybackState.FromPlaybackState(activeMediaControllers[0].PlaybackState)
                };
            }

            var currentForegroundPackageName = GetForegroundPackageName();
            if (currentForegroundPackageName != mediaState.PackageName)
            {
                mediaState = mediaState with
                {
                    AppName = GetAppName(currentForegroundPackageName),
                    PackageName = currentForegroundPackageName,
                    Metadata = default
                };
                playbackState = new PlaybackStateChanged { PlaybackState = default };
            }

            if (string.IsNullOrEmpty(mediaState.Metadata?.AlbumArtUri) && string.IsNullOrEmpty(mediaState.Metadata?.AlbumArt))
            {
                var albumIcon = GetAppIcon(mediaState.PackageName);
                if (!string.IsNullOrEmpty(albumIcon))
                {
                    mediaState = mediaState with
                    {
                        Metadata = (mediaState.Metadata == null) ? new Metadata { AlbumArt = albumIcon } : mediaState.Metadata with { AlbumArt = albumIcon }
                    };
                }
            }

            return (mediaState, playbackState);
        }

        private void RegisterForegroundService()
        {
            var channel = new NotificationChannel(Constants.DefaultNotificationChannelId, "RTI AndroidTV Companion", NotificationImportance.High);
            var notificationManager = (NotificationManager)GetSystemService(NotificationService);
            notificationManager.CreateNotificationChannel(channel);

            var notification = new Android.App.Notification.Builder(this, Constants.DefaultNotificationChannelId)
                .SetContentTitle(Resources.GetString(Resource.String.app_name))
                .SetContentIntent(BuildIntentToShowMainActivity())
                .SetOngoing(true)
                .Build();


            // Enlist this instance of the service as a foreground service
            StartForeground(Constants.ServiceRunningNotificationId, notification);
        }

        private PendingIntent BuildIntentToShowMainActivity()
        {
            var notificationIntent = new Intent(this, typeof(MainActivity));
            notificationIntent.SetAction(Constants.MainActivityAction);
            notificationIntent.SetFlags(ActivityFlags.SingleTop | ActivityFlags.ClearTask);
            notificationIntent.PutExtra(Constants.ServiceStartedKey, true);

            var pendingIntent = PendingIntent.GetActivity(this, 0, notificationIntent, PendingIntentFlags.UpdateCurrent | PendingIntentFlags.Immutable);
            return pendingIntent;
        }

        private bool CheckPermissions()
        {
            var isNotificationAccessPermissionEnabled = NotificationManagerCompat.GetEnabledListenerPackages(this).Contains(PackageName);

            AppOpsManager appOps = Application.Context.GetSystemService(AppOpsService) as AppOpsManager;
            var mode = appOps?.CheckOpNoThrow(AppOpsManager.OpstrGetUsageStats, ApplicationInfo.Uid, ApplicationInfo.PackageName) ?? AppOpsManagerMode.Errored;
            var isUsageAccessPermissionEnabled = (mode == AppOpsManagerMode.Default) ? (CheckSelfPermission(Android.Manifest.Permission.PackageUsageStats) == Permission.Granted) : (mode == AppOpsManagerMode.Allowed);

            return isNotificationAccessPermissionEnabled && isUsageAccessPermissionEnabled;
        }

        private Notification.Action BuildStopServiceAction()
        {
            var stopServiceIntent = new Intent(this, GetType());
            stopServiceIntent.SetAction(Constants.StopServiceAction);
            var stopServicePendingIntent = PendingIntent.GetService(this, 0, stopServiceIntent, 0);

            var builder = new Android.App.Notification.Action.Builder(Android.Resource.Drawable.IcMediaPause,
                                                          GetText(Resource.String.stop_service),
                                                          stopServicePendingIntent);
            return builder.Build();

        }

        private string? GetAppName(string? packageName)
        {
            if (string.IsNullOrEmpty(packageName)) return null;

            try
            {
                return PackageManager.GetApplicationLabel(PackageManager.GetApplicationInfo(packageName, PackageInfoFlags.MetaData));
            }
            catch { return default; }
        }

        private string? GetAppIcon(string? packageName)
        {
            if (string.IsNullOrEmpty(packageName)) return null;

            try
            {
                Drawable icon = null;
                var app = PackageManager.GetPackageInfo(packageName, PackageInfoFlags.MetaData);
                var intent = PackageManager.GetLeanbackLaunchIntentForPackage(packageName);

                if (app != null && icon == null)
                {
                    icon = app.ApplicationInfo.LoadIcon(PackageManager);
                }

                if (icon == null)
                {
                    icon = PackageManager.GetApplicationIcon(packageName);
                }

                if (intent != null && icon == null)
                {
                    icon = PackageManager.GetActivityIcon(intent);
                }

                if (app != null && icon == null)
                {
                    icon = app.ApplicationInfo.LoadBanner(PackageManager);
                }

                if (icon == null)
                {
                    icon = PackageManager.GetApplicationBanner(packageName);
                }

                if (intent != null && icon == null)
                {
                    icon = PackageManager.GetActivityBanner(intent);
                }

                if (icon == null)
                {
                    icon = PackageManager.DefaultActivityIcon;
                }

                if (icon != null)
                {
                    var bitmap = Bitmap.CreateBitmap(icon.IntrinsicWidth, icon.IntrinsicHeight, Bitmap.Config.Argb8888);
                    var canvas = new Canvas(bitmap);
                    icon.SetBounds(0, 0, canvas.Width, canvas.Height);
                    icon.Draw(canvas);
                    var scaledAlbumArtBitmap = bitmap.ScaleToFitCenter(Constants.IconWidth, Constants.IconHeight);
                    using var stream = new MemoryStream();
                    scaledAlbumArtBitmap.Compress(Bitmap.CompressFormat.Jpeg, 70, stream);
                    return Convert.ToBase64String(stream.ToArray());
                }

            }
            catch { return default; }

            return default;
        }

        private string? GetForegroundPackageName()
        {
            var result = default(string?);

            var currentUnixTime = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var usageEvents = _usageStatsManager.QueryEvents(currentUnixTime - 1000 * 3600, currentUnixTime);
            var usageEvent = new UsageEvents.Event();

            while (usageEvents.HasNextEvent)
            {
                usageEvents.GetNextEvent(usageEvent);
                if (usageEvent.EventType == UsageEventType.MoveToForeground)
                {
                    result = usageEvent.PackageName;
                }
            }

            return result;
        }

        private static void SendMessage<T>((string HostIp, int HostPort, int DeviceIndex) config, MessageWrapper<T> message)
        {
            try
            {
                var json = JsonSerializer.Serialize(message);
                var jsonBytes = System.Text.Encoding.UTF8.GetBytes(json);
                var jsonBase64 = System.Convert.ToBase64String(jsonBytes);
                var jsonBas64Bytes = System.Text.Encoding.ASCII.GetBytes(jsonBase64);

                using (var tcpClient = new TcpClient(config.HostIp, config.HostPort))
                using (var stream = tcpClient.GetStream())
                {
                    stream.Write(BitConverter.GetBytes(jsonBas64Bytes.Length).AsSpan());
                    stream.Write(jsonBas64Bytes.AsSpan());
                    stream.Flush();
                }
            } catch (Exception ex)
            {
                Crashes.TrackError(ex);
            }
        }
    }
}