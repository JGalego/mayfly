# What a Mayfly Containerfile may do. Checked with: conftest test --parser dockerfile --namespace containerfile
package containerfile

# conftest test passes the instructions as one flat list.
commands contains command if {
	some command in input
}

required_labels := {
	"org.opencontainers.image.title",
	"org.opencontainers.image.source",
	"org.opencontainers.image.revision",
	"org.opencontainers.image.licenses",
}

# Guards every other rule: a policy that sees no FROM is reading the wrong input and would pass anything.
deny contains msg if {
	not any_from
	msg := "no FROM found: is this a Containerfile?"
}

deny contains msg if {
	some command in commands
	command.Cmd == "from"
	not contains(command.Value[0], "@sha256:")
	msg := sprintf("FROM %s must be pinned by digest", [command.Value[0]])
}

deny contains msg if {
	some command in commands
	command.Cmd == "add"
	msg := "use COPY, not ADD: ADD can fetch URLs and unpack archives"
}

deny contains msg if {
	some command in commands
	command.Cmd == "run"
	msg := "no RUN: the image has no shell, and nothing should run while it is built"
}

deny contains msg if {
	some command in commands
	command.Cmd == "copy"
	some flag in command.Flags
	regex.match(`^--ch(own|mod)`, flag)
	msg := sprintf("COPY %s: copied files must stay owned by root and read-only to the app", [flag])
}

deny contains msg if {
	not final_user
	msg := "set USER to a numeric, non-root user"
}

deny contains msg if {
	not regex.match(`^[1-9][0-9]*(:[1-9][0-9]*)?$`, final_user)
	msg := sprintf("USER %s must be numeric and not root", [final_user])
}

deny contains msg if {
	some command in commands
	command.Cmd in {"entrypoint", "cmd"}
	not command.JSON
	msg := sprintf("%s must use the exec (JSON) form, since there is no shell", [upper(command.Cmd)])
}

deny contains msg if {
	some command in commands
	command.Cmd in {"env", "arg"}
	some value in command.Value
	regex.match(`(?i)^[a-z_]*(secret|password|passwd|token|api_?key)[a-z_]*(=|$)`, value)
	msg := sprintf("%s %s looks like a secret; secrets never go into an image", [upper(command.Cmd), value])
}

deny contains msg if {
	some label in required_labels
	not label_set(label)
	msg := sprintf("LABEL %s is required", [label])
}

final_user := users[count(users) - 1] if {
	users := [command.Value[0] | some command in commands; command.Cmd == "user"]
	count(users) > 0
}

any_from if {
	some command in commands
	command.Cmd == "from"
}

label_set(label) if {
	some command in commands
	command.Cmd == "label"
	some value in command.Value
	value == label
}
