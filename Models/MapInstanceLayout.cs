using System;
using System.ComponentModel.DataAnnotations;

namespace SERVER_OMSI_3_V1_0_0.Backend.Models
{
    /// <summary>
    /// Layout (objets placés en mode édition) d'une instance de map de société, en JSON brut —
    /// même format que LevelSaveLoad.LevelSaveData côté Unity ; le backend ne le désérialise pas,
    /// il le stocke et le rend tel quel.
    /// </summary>
    public class MapInstanceLayout
    {
        [Key]
        [MaxLength(64)]
        public string InstanceId { get; set; } = string.Empty;

        public string LevelJson { get; set; } = string.Empty;

        public DateTime UpdatedAt { get; set; }
    }
}
