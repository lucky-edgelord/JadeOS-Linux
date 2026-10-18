################################################################################
#
# jadeos: jaded + the native Jade Vault page
#
################################################################################

JADEOS_VERSION = 1.0.0
JADEOS_SITE = $(BR2_EXTERNAL_JADEOS_PATH)/native
JADEOS_SITE_METHOD = local
JADEOS_LICENSE = MIT
JADEOS_DEPENDENCIES = nodejs

# build/native-page.html is made by tools/make_native_page.py from Jade Vault's offline page
define JADEOS_INSTALL_TARGET_CMDS
	test -f $(BR2_EXTERNAL_JADEOS_PATH)/build/native-page.html || \
		{ echo "build/native-page.html is missing: run tools/fetch_page.sh first"; exit 1; }
	$(INSTALL) -d $(TARGET_DIR)/opt/jade
	$(INSTALL) -m 0644 $(@D)/jaded.mjs $(@D)/jade-cli.mjs $(@D)/native_tts.js $(TARGET_DIR)/opt/jade/
	$(INSTALL) -m 0644 $(BR2_EXTERNAL_JADEOS_PATH)/build/native-page.html $(TARGET_DIR)/opt/jade/jade-vault.html
	# Kokoro text to speech (tools/fetch_kokoro.sh): optional, jaded falls back to Flite without it
	if [ -f $(BR2_EXTERNAL_JADEOS_PATH)/build/kokoro/ready ]; then \
		rm -rf $(TARGET_DIR)/opt/kokoro; $(INSTALL) -d $(TARGET_DIR)/opt/kokoro; \
		cp -a $(BR2_EXTERNAL_JADEOS_PATH)/build/kokoro/. $(TARGET_DIR)/opt/kokoro/; \
	fi
endef

$(eval $(generic-package))
