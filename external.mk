include $(sort $(wildcard $(BR2_EXTERNAL_JADEOS_PATH)/package/*/*.mk))

# WPE WebKit's bundled Skia needs fontconfig, which Buildroot's wpewebkit recipe does not list as a dependency:
# make sure it is built (and in the sysroot) before wpewebkit is configured
$(BUILD_DIR)/wpewebkit-$(WPEWEBKIT_VERSION)/.stamp_configured: | fontconfig

# Cog's Wayland platform (needed for the cage kiosk) links cairo, which Buildroot's cog recipe does not list:
# build it (and have it in the sysroot) before cog is configured
$(BUILD_DIR)/cog-$(COG_VERSION)/.stamp_configured: | cairo
