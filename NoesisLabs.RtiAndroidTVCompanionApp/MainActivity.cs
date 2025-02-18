using Android.App;
using Android.Content;
using Android.Content.PM;
using Android.OS;
using AndroidX.Core.App;
using AndroidX.Fragment.App;
using AndroidX.Preference;
using Microsoft.AppCenter.Crashes;
using System;
using System.Collections.Generic;
using Xamarin.Essentials;

namespace NoesisLabs.RtiAndroidTVCompanionApp
{
    [Activity(Label = "@string/app_name", Name = "com.noesislabs.rtiandroidtvcompanion.MainActivity", Theme = "@style/AppTheme", MainLauncher = true, NoHistory = true, LaunchMode = LaunchMode.SingleTop, Exported = true)]
    [IntentFilter(new[] { Intent.ActionMain }, Categories = new[] { Intent.CategoryLauncher, Intent.CategoryLeanbackLauncher })]
    [IntentFilter(new[] { Constants.ConfigIntentAction })]
    [IntentFilter(new[] { Intent.ActionView }, Categories = new[] { Intent.CategoryDefault, Intent.CategoryBrowsable }, DataScheme = Constants.AppLinkDataScheme, DataHost = Constants.AppLinkDataHost, DataPath = "/config")]
    public class MainActivity : FragmentActivity
    {
        Intent startServiceIntent;

        protected override void OnCreate(Bundle savedInstanceState)
        {
            base.OnCreate(savedInstanceState);
            Xamarin.Essentials.Platform.Init(this, savedInstanceState);
            SetContentView(Resource.Layout.activity_main);

            var isNotificationAccessPermissionEnabled = NotificationManagerCompat.GetEnabledListenerPackages(this).Contains(PackageName);
            var notificationTextView = FindViewById<Android.Widget.TextView>(Resource.Id.notification_access_permission_text_view);
            var notficiationAccessPermissionStatus = isNotificationAccessPermissionEnabled ? "Success ✅" : "Failed ❌";
            notificationTextView.Text = $"Notification Access: { notficiationAccessPermissionStatus }";

            AppOpsManager appOps = Application.Context.GetSystemService(AppOpsService) as AppOpsManager;
            var mode = appOps?.CheckOpNoThrow(AppOpsManager.OpstrGetUsageStats, ApplicationInfo.Uid, ApplicationInfo.PackageName) ?? AppOpsManagerMode.Errored;
            var isUsageAccessPermissionEnabled = (mode == AppOpsManagerMode.Default) ? (CheckSelfPermission(Android.Manifest.Permission.PackageUsageStats) == Permission.Granted) : (mode == AppOpsManagerMode.Allowed);
            var usageTextView = FindViewById<Android.Widget.TextView>(Resource.Id.usage_access_permission_text_view);
            var usageAccessPermissionStatus = isUsageAccessPermissionEnabled ? "Success ✅" : "Failed ❌";
            usageTextView.Text = $"Usage Access: { usageAccessPermissionStatus }";

            startServiceIntent = new Intent(this, typeof(MediaNotificationService));
            startServiceIntent.SetAction(Constants.StartServiceAction);

            var prefs = PreferenceManager.GetDefaultSharedPreferences(this);
            var hostIp = prefs.GetString(Constants.HostIpKey, default(string?));
            var hostPort = prefs.GetInt(Constants.HostPortKey, 0);
            var deviceIndex = prefs.GetInt(Constants.DeviceIndexKey, 0);

            UpdateConfigDisplay(hostIp, (hostPort > 0 ? hostPort : null), (deviceIndex > 0 ? deviceIndex : null));
            StartService();
        }

        protected override void OnNewIntent(Intent intent)
        {
            base.OnNewIntent(intent);

            try
            {
                string hostIp = null;
                int hostPort = 0;
                int deviceIndex = 0;

                if (intent.Action == Constants.ConfigIntentAction)
                {
                    hostIp = intent.GetStringExtra(Constants.HostIpKey);
                    hostPort = intent.GetIntExtra(Constants.HostPortKey, 0);
                    deviceIndex = intent.GetIntExtra(Constants.DeviceIndexKey, 0);
                } else if (intent.Action == Intent.ActionView && intent.Data.Path == "/config")
                {
                    hostIp = intent.Data.GetQueryParameter(Constants.HostIpKey);
                    int.TryParse(intent.Data.GetQueryParameter(Constants.HostPortKey) ?? String.Empty, out hostPort);
                    int.TryParse(intent.Data.GetQueryParameter(Constants.DeviceIndexKey) ?? String.Empty, out deviceIndex);
                }

                if (!string.IsNullOrEmpty(hostIp) &&
                    hostPort > 0 &&
                    deviceIndex > 0)
                {
                    var prefs = PreferenceManager.GetDefaultSharedPreferences(this);
                    var editor = prefs.Edit();
                    editor.PutString(Constants.HostIpKey, hostIp);
                    editor.PutInt(Constants.HostPortKey, hostPort);
                    editor.PutInt(Constants.DeviceIndexKey, deviceIndex);
                    editor.Apply();

                    UpdateConfigDisplay(hostIp, hostPort, deviceIndex);
                    StartService();
                }
            }
            catch (Exception ex)
            {
                Crashes.TrackError(ex);
            }
        }

        protected void StartService()
        {
            StartForegroundService(startServiceIntent);
        }

        protected void UpdateConfigDisplay(string hostIp, int? hostPort, int? deviceIndex)
        {
            var hostIpTextView = FindViewById<Android.Widget.TextView>(Resource.Id.host_ip_text_view);
            hostIpTextView.Text = $"RTI Processor IP: {hostIp}";

            var hostPortTextView = FindViewById<Android.Widget.TextView>(Resource.Id.host_port_text_view);
            hostPortTextView.Text = $"RTI Processor Port: {hostPort}";

            var deviceIndexTextView = FindViewById<Android.Widget.TextView>(Resource.Id.device_index_text_view);
            deviceIndexTextView.Text = $"Device Index: {deviceIndex}";
        }
    }

    internal class MediaNotificationPermission : Permissions.BasePlatformPermission
    {
        public override (string androidPermission, bool isRuntime)[] RequiredPermissions => new List<(string androidPermission, bool isRuntime)>
        {
            (Android.Manifest.Permission.MediaContentControl, true)
        }.ToArray();
    }
}
