package ai.nimi.apps.openmontage.dev;

import com.getcapacitor.BridgeActivity;
import androidx.webkit.WebViewFeature;
import android.widget.TextView;

public class MainActivity extends BridgeActivity {
    @Override protected void load() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            TextView message = new TextView(this);
            message.setText("请更新 Android System WebView 后使用 OpenMontage。文件保存需要仅限主页面和已批准来源的通道。");
            message.setPadding(32, 64, 32, 32);
            setContentView(message);
            return;
        }
        registerPlugin(OpenMontageFilesPlugin.class);
        super.load();
        bridge.getWebView().removeJavascriptInterface("androidBridge");
    }
}
