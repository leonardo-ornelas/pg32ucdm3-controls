UUID := pg32ucdm3-controls@leonardo-ornelas.github.io
SCHEMA := schemas/org.gnome.shell.extensions.pg32ucdm3-controls.gschema.xml
BUNDLE := dist/$(UUID).shell-extension.zip
SOURCES := $(shell find src -name '*.ts')

.PHONY: all build pack install uninstall check clean

all: pack

build: build/extension.js

build/extension.js: $(SOURCES) tsconfig.json
	pnpm exec tsc

$(BUNDLE): build/extension.js metadata.json $(SCHEMA)
	cp metadata.json build/
	mkdir -p build/schemas dist
	cp $(SCHEMA) build/schemas/
	gnome-extensions pack --force --out-dir=dist --extra-source=lib --schema=$(SCHEMA) build

pack: $(BUNDLE)

# GNOME on Wayland only loads a newly installed extension after logging out and back in.
install: $(BUNDLE)
	gnome-extensions install --force $(BUNDLE)

uninstall:
	gnome-extensions uninstall $(UUID)

check:
	pnpm exec biome check .
	pnpm exec tsc --noEmit
	glib-compile-schemas --strict --dry-run schemas

clean:
	rm -rf build dist
