include $(sort $(wildcard $(BR2_EXTERNAL_JADEOS_PATH)/package/*/*.mk))

# WPE WebKit's bundled Skia needs fontconfig, which Buildroot's wpewebkit recipe does not list as a dependency:
# make sure it is built (and in the sysroot) before wpewebkit is configured
$(BUILD_DIR)/wpewebkit-$(WPEWEBKIT_VERSION)/.stamp_configured: | fontconfig
