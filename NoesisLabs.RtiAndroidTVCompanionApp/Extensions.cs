using Android.Graphics;
using System;

namespace NoesisLabs.RtiAndroidTVCompanionApp
{
    public static class Extensions
    {
        public static Bitmap ScaleToFitCenter(this Bitmap bitmap, int width, int height)
        {
            Matrix m = new();
            m.SetRectToRect(new RectF(0, 0, bitmap.Width, bitmap.Height), new RectF(0, 0, width, height), Matrix.ScaleToFit.Center);
            return Bitmap.CreateBitmap(bitmap, 0, 0, bitmap.Width, bitmap.Height, m, true);
        }

    }
}