package ai.nimi.apps.openmontage.dev;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.StatFs;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.util.Base64;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** One bounded local export sink. It receives finished App exports, not Runtime credentials or filesystem paths. */
@CapacitorPlugin(name = "OpenMontageFiles")
public class OpenMontageFilesPlugin extends Plugin {
    private static final long MAX_SAFE_INTEGER = 9007199254740991L;
    private String id, name, mime;
    private File staged;
    private OutputStream output;
    private long expected, size;
    private boolean choosing;
    private final ExecutorService copier = Executors.newSingleThreadExecutor();

    // JSONObject represents ordinary JS integers as Integer or Long depending on magnitude.
    // getLong() alone silently defaults for small Integer values; do not coerce strings or fractions.
    public static long exactInteger(Object value) {
        if (!(value instanceof Integer) && !(value instanceof Long)) throw new IllegalArgumentException("Expected an exact integer.");
        long number = ((Number) value).longValue();
        if (number < 0 || number > MAX_SAFE_INTEGER) throw new IllegalArgumentException("Integer is outside the exact transfer range.");
        return number;
    }

    public static String exportName(String name) {
        if (name.isBlank() || name.length() > 240 || name.equals(".") || name.equals("..")
            || name.indexOf('/') >= 0 || name.indexOf('\\') >= 0
            || name.chars().anyMatch(value -> value < 32 || value == 127))
            throw new IllegalArgumentException("Invalid export filename.");
        return name;
    }

    public static String mimeEssence(String value) {
        String mime = value.split(";", 2)[0].trim();
        if (!mime.matches("[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+")) throw new IllegalArgumentException("Invalid file type.");
        return mime;
    }

    @Override public void load() {
        File[] files = getContext().getCacheDir().listFiles((directory, filename) -> filename.startsWith("openmontage-export-") && filename.endsWith(".tmp"));
        if (files != null) for (File file : files) file.delete();
    }

    @PluginMethod public synchronized void beginExport(PluginCall call) {
        try {
            if (id != null) throw new IllegalStateException("Finish the current file save first.");
            String requested = exportName(call.getString("name", ""));
            String requestedMime = mimeEssence(call.getString("mimeType", "application/octet-stream"));
            long requestedSize = exactInteger(call.getData().opt("size"));
            if (requestedSize > new StatFs(getContext().getCacheDir().getAbsolutePath()).getAvailableBytes()) throw new IllegalStateException("Not enough device space to receive this file. The original remains on the PC.");
            staged = File.createTempFile("openmontage-export-", ".tmp", getContext().getCacheDir());
            try { output = new FileOutputStream(staged); }
            catch (Exception error) { staged.delete(); staged = null; throw error; } id = UUID.randomUUID().toString(); name = requested; mime = requestedMime; expected = requestedSize; size = 0;
            JSObject result = new JSObject(); result.put("id", id); call.resolve(result);
        } catch (Exception error) { call.reject(error.getMessage(), "OPENMONTAGE_EXPORT_UNAVAILABLE"); }
    }

    @PluginMethod public synchronized void appendExport(PluginCall call) {
        try {
            require(call); String encoded = call.getString("data", "");
            if (choosing || output == null || encoded.isEmpty() || encoded.length() > 87384 || !encoded.matches("(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?")) throw new IllegalArgumentException("Invalid file chunk.");
            byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
            if (bytes.length == 0 || bytes.length > 65536 || size + bytes.length > expected || exactInteger(call.getData().opt("offset")) != size) throw new IllegalArgumentException("File chunks must match the declared size and order.");
            output.write(bytes); size += bytes.length;
            JSObject result = new JSObject(); result.put("received", size); call.resolve(result);
        } catch (Exception error) { call.reject(error.getMessage(), "OPENMONTAGE_EXPORT_WRITE_FAILED"); }
    }

    @PluginMethod public synchronized void saveExport(PluginCall call) {
        try { require(call); }
        catch (IllegalArgumentException error) { call.reject(error.getMessage(), "OPENMONTAGE_EXPORT_SAVE_FAILED"); return; }
        try {
            if (choosing || output == null || size != expected) throw new IllegalStateException("The file transfer is incomplete.");
            output.close(); output = null; choosing = true;
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE, name);
            startActivityForResult(call, intent, "exportDestination");
        } catch (Exception error) { cleanup(); call.reject(error.getMessage(), "OPENMONTAGE_EXPORT_SAVE_FAILED"); }
    }

    @ActivityCallback private synchronized void exportDestination(PluginCall call, ActivityResult result) {
        if (call == null) { cleanup(); return; }
        try {
            require(call); Uri destination = result.getData() == null ? null : result.getData().getData();
            if (result.getResultCode() != Activity.RESULT_OK || destination == null) { cleanup(); call.reject("File saving was canceled.", "OPENMONTAGE_EXPORT_CANCELED"); return; }
            final File source = staged; final long sourceSize = size; final String sourceName = name;
            copier.execute(() -> {
                try {
                    long copied = 0;
                    try (FileInputStream input = new FileInputStream(source); OutputStream target = getContext().getContentResolver().openOutputStream(destination)) {
                        if (target == null) throw new IllegalStateException("The selected destination is unavailable.");
                        byte[] buffer = new byte[65536]; int count;
                        while ((count = input.read(buffer)) != -1) { if (Thread.currentThread().isInterrupted()) throw new IllegalStateException("File save interrupted."); target.write(buffer, 0, count); copied += count; }
                        target.flush();
                    }
                    if (copied != sourceSize) throw new IllegalStateException("The staged file is incomplete.");
                    JSObject saved = new JSObject(); saved.put("bytesWritten", copied); saved.put("name", sourceName); synchronized (this) { cleanup(); } call.resolve(saved);
                } catch (Exception error) { synchronized (this) { cleanup(); } call.reject("The file was not completely saved. Check the selected destination; the original remains on the PC.", "OPENMONTAGE_EXPORT_SAVE_FAILED"); }
            });
        } catch (Exception error) { cleanup(); call.reject(error.getMessage(), "OPENMONTAGE_EXPORT_SAVE_FAILED"); }
    }
    @PluginMethod public synchronized void abortExport(PluginCall call) { if (id != null && id.equals(call.getString("id")) && !choosing) cleanup(); call.resolve(); }
    private void require(PluginCall call) { if (id == null || !id.equals(call.getString("id"))) throw new IllegalArgumentException("Unknown file transfer."); }
    private void cleanup() { try { if (output != null) output.close(); } catch (Exception ignored) {} if (staged != null) staged.delete(); output = null; staged = null; id = null; name = null; mime = null; choosing = false; expected = 0; size = 0; }
    @Override protected synchronized void handleOnDestroy() { copier.shutdownNow(); cleanup(); }
}
