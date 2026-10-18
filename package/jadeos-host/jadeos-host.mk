################################################################################
#
# jadeos-host: jaded + the Jade Vault page (built beforehand: python3 app/build.py)
#
################################################################################

JADEOS_HOST_VERSION = native-host
JADEOS_HOST_SITE = $(call github,lucky-edgelord,jade-vault,$(JADEOS_HOST_VERSION))
JADEOS_HOST_LICENSE = MIT
JADEOS_HOST_DEPENDENCIES = nodejs

# the tarball does not contain dist/ (it is built); scripts/build.sh points OVERRIDE_SRCDIR at a built checkout
define JADEOS_HOST_INSTALL_TARGET_CMDS
	$(INSTALL) -d $(TARGET_DIR)/opt/jaded
	$(INSTALL) -m 0644 $(@D)/native/jaded.mjs $(TARGET_DIR)/opt/jaded/jaded.mjs
	$(INSTALL) -m 0644 $(@D)/native/jade-cli.mjs $(TARGET_DIR)/opt/jaded/jade-cli.mjs
	$(INSTALL) -m 0644 $(@D)/dist/jade-vault.html $(TARGET_DIR)/opt/jaded/jade-vault.html
endef

$(eval $(generic-package))
