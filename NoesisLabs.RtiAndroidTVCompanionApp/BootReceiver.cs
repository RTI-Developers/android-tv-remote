using Android.App;
using Android.Content;

namespace NoesisLabs.RtiAndroidTVCompanionApp
{
    [BroadcastReceiver(Exported = true)]
    [IntentFilter(new[] { Intent.ActionBootCompleted })]
    public class BootReceiver : BroadcastReceiver
    {
        public override void OnReceive(Context context, Intent intent)
        {
            if (intent.Action == Intent.ActionBootCompleted)
            {
                var startServiceIntent = new Intent(context, typeof(MediaNotificationService));
                startServiceIntent.SetAction(Constants.StartServiceAction);
                context.StartForegroundService(startServiceIntent);
            }
        }
    }
}