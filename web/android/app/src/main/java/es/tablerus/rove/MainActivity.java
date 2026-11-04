package es.tablerus.rove;

import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.Plugin;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import com.getcapacitor.BridgeActivity;

// ModifiedMainActivityForSocialLoginPlugin is VERY VERY important !!!!!!
public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {

      @Override
      public void onCreate(Bundle savedInstanceState) {
        // Before super.onCreate: the bridge is built there, and it only picks up plugins that were
        // registered by then.
        registerPlugin(ReducedMotionPlugin.class);
        super.onCreate(savedInstanceState);
        openShared(getIntent());
      }

      @Override
      protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openShared(intent);
      }

      /* The share sheet (see the SEND filter in AndroidManifest.xml): Instagram, Xiaohongshu and
         WeChat share a caption with a link in it as text/plain. It opens /add with that text,
         which is exactly what the PWA's share_target does, so the page finds the link the same
         way (lib/shareTarget.ts). Loaded after the bridge's own start page, replacing it. */
      private void openShared(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null || text.isEmpty()) return;
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        String url = getBridge().getLocalUrl() + "/add?text=" + Uri.encode(text)
            + (subject != null ? "&title=" + Uri.encode(subject) : "");
        // Handled once: a recreated activity must not open the same share again.
        intent.setAction(Intent.ACTION_MAIN);
        getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(url));
      }

      @Override
      public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN && requestCode < GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX) {
          PluginHandle pluginHandle = getBridge().getPlugin("SocialLogin");
          if (pluginHandle == null) {
            Log.i("Google Activity Result", "SocialLogin login handle is null");
            return;
          }
          Plugin plugin = pluginHandle.getInstance();
          if (!(plugin instanceof SocialLoginPlugin)) {
            Log.i("Google Activity Result", "SocialLogin plugin instance is not SocialLoginPlugin");
            return;
          }
          ((SocialLoginPlugin) plugin).handleGoogleLoginIntent(requestCode, data);
        }
      }

      // This function will never be called, leave it empty
      @Override
      public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {}
}