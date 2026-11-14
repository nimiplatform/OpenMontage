package ai.nimi.apps.openmontage.dev;

import static org.junit.Assert.*;
import org.junit.Test;

public class OpenMontageFilesPluginTest {
    @Test public void transferOffsetsAcceptRealJsonIntegerRepresentations() {
        assertEquals(0, OpenMontageFilesPlugin.exactInteger(Integer.valueOf(0)));
        assertEquals(4294967296L, OpenMontageFilesPlugin.exactInteger(Long.valueOf(4294967296L)));
        assertThrows(IllegalArgumentException.class, () -> OpenMontageFilesPlugin.exactInteger("0"));
        assertThrows(IllegalArgumentException.class, () -> OpenMontageFilesPlugin.exactInteger(0.5));
        assertThrows(IllegalArgumentException.class, () -> OpenMontageFilesPlugin.exactInteger(-1));
    }

    @Test public void textCharsetDoesNotPreventSystemFileSaving() {
        assertEquals("text/plain", OpenMontageFilesPlugin.mimeEssence("text/plain;charset=utf-8"));
        assertEquals("application/x-subrip", OpenMontageFilesPlugin.mimeEssence("application/x-subrip"));
        assertEquals("video/mp4", OpenMontageFilesPlugin.mimeEssence("video/mp4"));
        assertThrows(IllegalArgumentException.class, () -> OpenMontageFilesPlugin.mimeEssence("text/plain\r\nother"));
    }

    @Test public void unicodeNamesRemainNamesRatherThanPaths() {
        assertEquals("Android 夜间图书馆.mp4", OpenMontageFilesPlugin.exportName("Android 夜间图书馆.mp4"));
        assertThrows(IllegalArgumentException.class, () -> OpenMontageFilesPlugin.exportName("../video.mp4"));
        assertThrows(IllegalArgumentException.class, () -> OpenMontageFilesPlugin.exportName("folder\\video.mp4"));
        assertThrows(IllegalArgumentException.class, () -> OpenMontageFilesPlugin.exportName("bad\nname.txt"));
    }
}
