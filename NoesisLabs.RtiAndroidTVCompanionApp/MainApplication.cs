using Android.App;
using Android.Runtime;
using Microsoft.AppCenter;
using Microsoft.AppCenter.Analytics;
using Microsoft.AppCenter.Crashes;
using System;

namespace NoesisLabs.RtiAndroidTVCompanionApp
{
    [Application(UsesCleartextTraffic =true)]
    public class MainApplication : Application
    {
        public MainApplication(IntPtr javaReference, JniHandleOwnership transfer) : base(javaReference, transfer)
        { }

        public override void OnCreate()
        {
            base.OnCreate();
            AppCenter.Start("4e342c95-c11d-44df-81fd-565bf0fd239c",
                   typeof(Analytics), typeof(Crashes));
        }
    }
}