package com.kuanwei.inventory;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(AppUpdatePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
