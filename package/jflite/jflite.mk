################################################################################
#
# jflite
#
################################################################################

JFLITE_VERSION = 2.2
JFLITE_SITE = $(call github,festvox,flite,v$(JFLITE_VERSION))
JFLITE_LICENSE = BSD-4-Clause
JFLITE_LICENSE_FILES = COPYING
JFLITE_CPE_ID_VENDOR = cmu

JFLITE_INSTALL_STAGING = YES
# Patching configure.in
JFLITE_AUTORECONF = YES
JFLITE_DEPENDENCIES = host-pkgconf

# Sadly, Flite does not support parallel build, especially when building its
# shared libraries.
JFLITE_MAKE = $(MAKE1)

ifeq ($(BR2_PACKAGE_ALSA_LIB),y)
JFLITE_DEPENDENCIES += alsa-lib
JFLITE_CONF_OPTS += --with-audio=alsa
else
JFLITE_CONF_OPTS += --with-audio=oss
endif

$(eval $(autotools-package))
