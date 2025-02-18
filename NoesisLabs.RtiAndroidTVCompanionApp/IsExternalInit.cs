// Without this dummy class C#9's records won't compile
namespace System.Runtime.CompilerServices
{
    public static class IsExternalInit
    {
    }
}