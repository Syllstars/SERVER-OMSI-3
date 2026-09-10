using System;
using System.ComponentModel.DataAnnotations;

namespace SERVER_OMSI_3_V1_0_0.Backend.Models
{
    /// <summary>
    /// Registre des serveurs de map — locaux (Pi) ou distants (PC, autre machine).
    /// Alimenté par les heartbeats des serveurs Unity eux-mêmes : chaque serveur
    /// se déclare au démarrage puis toutes les ~15 s. Un serveur dont le dernier
    /// heartbeat date de plus de 45 s est considéré hors ligne.
    ///
    /// C'est CETTE table que PlayerController consulte pour donner l'adresse
    /// aux clients — plus d'IP codée en dur.
    /// </summary>
    public class RegisteredServer
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        /// <summary>Identifiant logique de la map : "AdminServer", "Liege"...
        /// Unique — un heartbeat portant un nom existant met à jour la ligne.</summary>
        [Required]
        [MaxLength(64)]
        public string Name { get; set; } = string.Empty;

        /// <summary>IP à communiquer aux clients (IP Tailscale de la machine hôte).
        /// Auto-détectée depuis le heartbeat, sauf si ManualIpOverride est défini.</summary>
        [MaxLength(45)]
        public string Ip { get; set; } = string.Empty;

        /// <summary>Override manuel depuis le Dashboard. Si non vide, prime sur
        /// l'IP auto-détectée (utile derrière un NAT exotique ou pour forcer
        /// une adresse précise).</summary>
        [MaxLength(45)]
        public string? ManualIpOverride { get; set; }

        public int Port { get; set; }

        public DateTime LastHeartbeatUtc { get; set; }

        public int PlayersOnline { get; set; }

        /// <summary>Renseigné par le heartbeat : nom de machine, pour affichage
        /// Dashboard ("tourne sur DESKTOP-MAXIME" vs "tourne sur Raspberry").</summary>
        [MaxLength(128)]
        public string? HostMachine { get; set; }

        // ─── Propriétés calculées (non mappées, pour les DTO/Dashboard) ───

        public const int OnlineThresholdSeconds = 45;

        public bool IsOnline =>
            (DateTime.UtcNow - LastHeartbeatUtc).TotalSeconds < OnlineThresholdSeconds;

        /// <summary>L'IP effective servie aux clients.</summary>
        public string EffectiveIp =>
            string.IsNullOrWhiteSpace(ManualIpOverride) ? Ip : ManualIpOverride;
    }
}
