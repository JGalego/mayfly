package containerfile_test

import data.containerfile

good := [
	{"Cmd": "from", "Flags": [], "Value": ["localhost/base@sha256:abc"], "JSON": false},
	{"Cmd": "label", "Flags": [], "Value": [
		"org.opencontainers.image.title", "\"t\"", "=",
		"org.opencontainers.image.source", "\"s\"", "=",
		"org.opencontainers.image.revision", "\"r\"", "=",
		"org.opencontainers.image.licenses", "\"AGPL-3.0-only\"", "=",
	], "JSON": false},
	{"Cmd": "copy", "Flags": [], "Value": ["src", "./runtime"], "JSON": false},
	{"Cmd": "user", "Flags": [], "Value": ["65532:65532"], "JSON": false},
	{"Cmd": "entrypoint", "Flags": [], "Value": ["/usr/bin/node", "/app/runtime/server.ts"], "JSON": true},
]

with_command(command) := array.concat(good, [command])

replacing(cmd, command) := array.concat([c | some c in good; c.Cmd != cmd], [command])

test_a_good_containerfile_passes if {
	count(containerfile.deny) == 0 with input as good
}

test_from_must_be_pinned_by_digest if {
	containerfile.deny["FROM localhost/base:latest must be pinned by digest"] with input as replacing("from", {"Cmd": "from", "Flags": [], "Value": ["localhost/base:latest"]})
}

test_add_is_refused if {
	count(containerfile.deny) == 1 with input as with_command({"Cmd": "add", "Flags": [], "Value": ["https://x", "/x"]})
}

test_run_is_refused if {
	count(containerfile.deny) == 1 with input as with_command({"Cmd": "run", "Flags": [], "Value": ["true"]})
}

test_copy_may_not_change_ownership if {
	count(containerfile.deny) == 1 with input as with_command({"Cmd": "copy", "Flags": ["--chown=65532"], "Value": ["a", "b"]})
}

test_user_is_required if {
	containerfile.deny["set USER to a numeric, non-root user"] with input as [c | some c in good; c.Cmd != "user"]
}

test_root_and_named_users_are_refused if {
	every user in ["0", "root", "nonroot", "0:0"] {
		count(containerfile.deny) == 1 with input as replacing("user", {"Cmd": "user", "Flags": [], "Value": [user]})
	}
}

test_shell_form_entrypoint_is_refused if {
	count(containerfile.deny) == 1 with input as replacing("entrypoint", {"Cmd": "entrypoint", "Flags": [], "Value": ["node server.ts"], "JSON": false})
}

test_secret_looking_env_is_refused if {
	every value in ["API_KEY=x", "DB_PASSWORD", "GITHUB_TOKEN=y", "client_secret"] {
		count(containerfile.deny) == 1 with input as with_command({"Cmd": "env", "Flags": [], "Value": [value]})
	}
}

test_ordinary_env_is_fine if {
	count(containerfile.deny) == 0 with input as with_command({"Cmd": "env", "Flags": [], "Value": ["NODE_ENV", "production"]})
}

test_labels_are_required if {
	containerfile.deny["LABEL org.opencontainers.image.revision is required"] with input as [c | some c in good; c.Cmd != "label"]
}

test_the_license_label_is_required if {
	containerfile.deny["LABEL org.opencontainers.image.licenses is required"] with input as replacing("label", {"Cmd": "label", "Flags": [], "Value": [
		"org.opencontainers.image.title", "\"t\"", "=",
		"org.opencontainers.image.source", "\"s\"", "=",
		"org.opencontainers.image.revision", "\"r\"", "=",
	]})
}

test_input_without_from_fails_rather_than_passes if {
	containerfile.deny["no FROM found: is this a Containerfile?"] with input as []
}
