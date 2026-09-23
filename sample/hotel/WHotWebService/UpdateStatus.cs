namespace PortoInf.Interop
{

    internal class UpdateStatus
    {
        public static int Total;

        public static int Updated;

        public static void Reset()
        {
            Total = 0;
            Updated = 0;
        }
    }
}
