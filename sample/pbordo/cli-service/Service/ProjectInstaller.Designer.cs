namespace PIWebService
{
    partial class ProjectInstaller
    {
        /// <summary>
        /// Required designer variable.
        /// </summary>
        private System.ComponentModel.IContainer components = null;

        /// <summary> 
        /// Clean up any resources being used.
        /// </summary>
        /// <param name="disposing">true if managed resources should be disposed; otherwise, false.</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        #region Component Designer generated code

        /// <summary>
        /// Required method for Designer support - do not modify
        /// the contents of this method with the code editor.
        /// </summary>
        private void InitializeComponent()
        {
            this.piWebService = new System.ServiceProcess.ServiceProcessInstaller();
            this.serviceInstaller1 = new System.ServiceProcess.ServiceInstaller();
            // 
            // piWebService
            // 
            this.piWebService.Account = System.ServiceProcess.ServiceAccount.LocalSystem;
            this.piWebService.Password = null;
            this.piWebService.Username = null;
            this.piWebService.AfterInstall += new System.Configuration.Install.InstallEventHandler(this.PiWebService_AfterInstall);
            // 
            // serviceInstaller1
            // 
            this.serviceInstaller1.DelayedAutoStart = true;
            this.serviceInstaller1.Description = "Painel de Bordo para aplicação Wintouch";
            this.serviceInstaller1.ServiceName = "Painel de Bordo ";
            this.serviceInstaller1.StartType = System.ServiceProcess.ServiceStartMode.Automatic;
            // 
            // ProjectInstaller
            // 
            this.Installers.AddRange(new System.Configuration.Install.Installer[] {
            this.piWebService,
            this.serviceInstaller1});

        }

        #endregion

        private System.ServiceProcess.ServiceProcessInstaller piWebService;
        private System.ServiceProcess.ServiceInstaller serviceInstaller1;
    }
}