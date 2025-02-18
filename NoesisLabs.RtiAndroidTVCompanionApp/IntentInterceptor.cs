using Android.App;
using Android.Content;
using Android.Content.PM;
using Android.OS;

namespace NoesisLabs.RtiAndroidTVCompanionApp
{
    [Activity(Label = "IntentInterceptor", Name = "com.noesislabs.rtiandroidtvcompanion.IntentInterceptor", Theme = "@android:style/Theme.NoDisplay", NoHistory = true, LaunchMode = LaunchMode.SingleTop, Exported = true)]
    [IntentFilter(new[] { Constants.SyncIntentAction })]
    [IntentFilter(new[] { Intent.ActionView }, Categories = new[] { Intent.CategoryDefault, Intent.CategoryBrowsable }, DataScheme = Constants.AppLinkDataScheme, DataHost = Constants.AppLinkDataHost, DataPath = "/sync")]
    public class IntentInterceptor : Activity
    {
        protected override void OnCreate(Bundle savedInstanceState)
        {
            base.OnCreate(savedInstanceState);

            var serviceIntent = new Intent(this, typeof(MediaNotificationService));
            serviceIntent.SetAction(Constants.StartServiceAction);

            StartForegroundService(serviceIntent);
            Finish();

            return;
        }
    }
}