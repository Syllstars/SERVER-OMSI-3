using System;

using System.ComponentModel.DataAnnotations.Schema;

namespace SERVER_OMSI_3_V1_0_0.Backend.Models;

public class HofFile
{
    public Guid Id { get; set; }
    public string MapName { get; set; }
    public string FileName { get; set; }
    public byte[] FileContent { get; set; }
    public DateTime UploadedAt { get; set; }
}
