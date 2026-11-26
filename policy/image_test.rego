package image_test

import data.image

good := {
	"config": {
		"User": "65532:65532",
		"Entrypoint": ["/usr/bin/node", "/app/runtime/server.ts"],
		"Env": ["PATH=/usr/bin", "NODE_ENV=production"],
		"Labels": {
			"org.opencontainers.image.title": "t",
			"org.opencontainers.image.source": "s",
			"org.opencontainers.image.revision": "r",
		},
	},
	"size": 150000000,
	"files": [
		{"path": "usr/bin/node", "mode": 493, "uid": 0, "gid": 0, "type": "file"},
		{"path": "tmp", "mode": 1023, "uid": 0, "gid": 0, "type": "directory"},
		{"path": "app/runtime/server.ts", "mode": 420, "uid": 0, "gid": 0, "type": "file"},
		{"path": "usr/lib/libz.so.1", "mode": 511, "uid": 0, "gid": 0, "type": "symlink"},
	],
}

with_file(file) := object.union(good, {"files": array.concat(good.files, [file])})

test_a_good_image_passes if {
	count(image.deny) == 0 with input as good
}

test_root_user_is_refused if {
	every user in ["", "0", "root", "0:0"] {
		count(image.deny) == 1 with input as object.union(good, {"config": object.union(good.config, {"User": user})})
	}
}

test_entrypoint_is_fixed if {
	count(image.deny) == 1 with input as object.union(good, {"config": object.union(good.config, {"Entrypoint": ["/bin/sh"]})})
}

test_shells_package_managers_and_downloaders_are_refused if {
	every path in ["bin/sh", "usr/bin/bash", "bin/busybox", "usr/bin/npm", "sbin/apk", "usr/bin/curl", "usr/bin/wget"] {
		count(image.deny) == 1 with input as with_file({"path": path, "mode": 493, "uid": 0, "gid": 0, "type": "file"})
	}
}

test_setuid_files_are_refused if {
	count(image.deny) == 1 with input as with_file({"path": "usr/bin/su2", "mode": 2541, "uid": 0, "gid": 0, "type": "file"})
}

test_world_writable_files_are_refused if {
	count(image.deny) == 1 with input as with_file({"path": "etc/passwd", "mode": 438, "uid": 0, "gid": 0, "type": "file"})
}

test_app_files_must_be_root_owned_and_read_only if {
	every file in [
		{"path": "app/routes.ts", "mode": 420, "uid": 65532, "gid": 0, "type": "file"},
		{"path": "app/routes.ts", "mode": 436, "uid": 0, "gid": 0, "type": "file"},
	] {
		count(image.deny) == 1 with input as with_file(file)
	}
}

test_tests_are_refused if {
	count(image.deny) == 1 with input as with_file({"path": "app/runtime/app.test.ts", "mode": 420, "uid": 0, "gid": 0, "type": "file"})
}

test_size_budget if {
	count(image.deny) == 1 with input as object.union(good, {"size": 161000000})
}

test_secret_looking_env_is_refused if {
	count(image.deny) == 1 with input as object.union(good, {"config": object.union(good.config, {"Env": ["OPENAI_API_KEY=sk"]})})
}

test_labels_are_required if {
	count(image.deny) == 1 with input as json.remove(good, ["config/Labels/org.opencontainers.image.revision"])
}
