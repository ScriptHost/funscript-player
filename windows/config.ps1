# Einstellungen für den Handy Player unter Windows.
# Nach Änderungen den Player neu starten (bzw. setup.ps1 erneut ausführen, wenn sich Port oder HTTPS ändern).
@{
    # Ordner mit Videos und gleichnamigen .funscript-Dateien (auch UNC-Pfade wie \\nas\filme).
    # Jeder Unterordner (z. B. D:\Filme\Downloads) erscheint als eigene Quelle in der Bibliothek.
    MediaDir   = 'D:\Filme'

    # Netzwerk: 0.0.0.0 = von überall erreichbar, 127.0.0.1 = nur lokal (z. B. Reverse Proxy auf derselben VM)
    BindHost   = '0.0.0.0'
    Port       = 8443

    # Anmeldung im Browser (leer lassen, wenn dein Reverse Proxy das übernimmt)
    AuthUser   = 'ich'
    AuthPass   = 'bitte-aendern'

    # HTTPS direkt im Player. Auf $false setzen, wenn dein Reverse Proxy TLS terminiert.
    Https      = $true
    # Zertifikat als .pfx. setup.ps1 erzeugt hier ein selbstsigniertes, falls die Datei fehlt.
    # Du kannst auch ein eigenes Zertifikat deiner internen CA hier ablegen.
    PfxFile    = "$PSScriptRoot\cert\handy-player.pfx"
    PfxPass    = 'handy-player'
    # Namen/IPs, für die das selbstsignierte Zertifikat gelten soll
    CertNames  = @('handy.home.lan', 'localhost')

    # Stash als zusätzliche Bibliothek (leer lassen = aus)
    StashUrl      = ''
    StashApiKey   = ''      # nur nötig, wenn in Stash Benutzername/Passwort gesetzt sind
    StashInsecure = $false  # $true, wenn Stash ein selbstsigniertes Zertifikat hat
}
