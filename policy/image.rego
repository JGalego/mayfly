# What a built Mayfly image may contain. The input is the "facts" policy/image-facts.ts collects:
# the image config, its size, and every file with its mode and owner.
package image

max_size_mb := 160

entrypoint := ["/usr/bin/node", "/app/runtime/server.ts"]

required_labels := {
	"org.opencontainers.image.title",
	"org.opencontainers.image.source",
	"org.opencontainers.image.revision",
}

# Nothing an attacker could use to run commands, install things or fetch payloads.
forbidden_tools := `(^|/)s?bin/(sh|bash|ash|dash|zsh|ksh|busybox|apk|apt|apt-get|dpkg|rpm|yum|dnf|npm|npx|corepack|yarn|pnpm|pip3?|curl|wget|nc|netcat|ssh|scp)$`

setid := 3072 # 0o6000: setuid and setgid

sticky := 512 # 0o1000

group_or_other_write := 18 # 0o022

other_write := 2 # 0o002

deny contains msg if {
	not regex.match(`^[1-9][0-9]*(:[1-9][0-9]*)?$`, input.config.User)
	msg := sprintf("the image must run as a numeric, non-root user, not %q", [input.config.User])
}

deny contains msg if {
	input.config.Entrypoint != entrypoint
	msg := sprintf("the entrypoint must be %v", [entrypoint])
}

deny contains msg if {
	some file in input.files
	regex.match(forbidden_tools, file.path)
	msg := sprintf("%s must not be in the image", [file.path])
}

deny contains msg if {
	some file in input.files
	bits.and(file.mode, setid) != 0
	msg := sprintf("%s is setuid or setgid", [file.path])
}

deny contains msg if {
	some file in input.files
	file.type != "symlink"
	bits.and(file.mode, other_write) != 0
	not sticky_directory(file)
	msg := sprintf("%s is writable by anyone", [file.path])
}

deny contains msg if {
	some file in input.files
	startswith(file.path, "app/")
	file.type != "symlink"
	not owned_by_root_read_only(file)
	msg := sprintf("%s must be owned by root and not writable by the app", [file.path])
}

deny contains msg if {
	some file in input.files
	endswith(file.path, ".test.ts")
	msg := sprintf("%s is a test and does not belong in the image", [file.path])
}

deny contains msg if {
	input.size > max_size_mb * 1000000
	msg := sprintf("the image is %d MB, over the %d MB budget", [input.size / 1000000, max_size_mb])
}

deny contains msg if {
	some variable in input.config.Env
	regex.match(`(?i)^[a-z_]*(secret|password|passwd|token|api_?key)[a-z_]*=`, variable)
	msg := sprintf("environment variable %s looks like a secret", [split(variable, "=")[0]])
}

deny contains msg if {
	some label in required_labels
	not input.config.Labels[label]
	msg := sprintf("label %s is required", [label])
}

sticky_directory(file) if {
	file.type == "directory"
	bits.and(file.mode, sticky) != 0
}

owned_by_root_read_only(file) if {
	file.uid == 0
	bits.and(file.mode, group_or_other_write) == 0
}
