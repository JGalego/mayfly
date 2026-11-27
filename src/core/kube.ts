// The subset of Kubernetes objects Mayfly writes, with Kubernetes field names.

export interface Pod {
  readonly apiVersion: "v1";
  readonly kind: "Pod";
  readonly metadata: { readonly name: string };
  readonly spec: { readonly containers: readonly Container[]; readonly volumes?: readonly Volume[] };
}

export interface ConfigMap {
  readonly apiVersion: "v1";
  readonly kind: "ConfigMap";
  readonly metadata: { readonly name: string };
  readonly data: Readonly<Record<string, string>>;
}

export interface Secret {
  readonly apiVersion: "v1";
  readonly kind: "Secret";
  readonly metadata: { readonly name: string };
  readonly stringData: Readonly<Record<string, string>>;
}

/** Storage that outlives a pod: Podman keeps its volume until it's removed on purpose. */
export interface PersistentVolumeClaim {
  readonly apiVersion: "v1";
  readonly kind: "PersistentVolumeClaim";
  /** Podman reads volume.podman.io/uid and gid to give the volume to the user who writes to it. */
  readonly metadata: { readonly name: string; readonly annotations: Readonly<Record<string, string>> };
  readonly spec: { readonly accessModes: readonly ["ReadWriteOnce"]; readonly resources: { readonly requests: { readonly storage: string } } };
}

export type KubeObject = Pod | ConfigMap | Secret | PersistentVolumeClaim;

/** Every container Mayfly writes is hardened and capped. */
export interface Container {
  readonly name: string;
  readonly image: string;
  readonly imagePullPolicy?: "IfNotPresent";
  readonly args?: readonly string[];
  readonly env?: readonly EnvVar[];
  readonly envFrom?: readonly { readonly configMapRef: { readonly name: string } }[];
  readonly ports?: readonly ContainerPort[];
  readonly volumeMounts?: readonly VolumeMount[];
  readonly livenessProbe?: Probe;
  readonly securityContext: SecurityContext;
  readonly resources: { readonly limits: { readonly cpu: string; readonly memory: string } };
}

export type EnvVar =
  | { readonly name: string; readonly value: string }
  | { readonly name: string; readonly valueFrom: { readonly secretKeyRef: SecretKeyRef } };

export interface SecretKeyRef {
  readonly name: string;
  readonly key: string;
}

export interface ContainerPort {
  readonly containerPort: number;
  readonly hostPort: number;
  readonly hostIP: string;
}

export type Volume = SecretVolume | ConfigMapVolume | ClaimVolume;

export interface SecretVolume {
  readonly name: string;
  readonly secret: { readonly secretName: string };
}

export interface ConfigMapVolume {
  readonly name: string;
  readonly configMap: { readonly name: string };
}

export interface ClaimVolume {
  readonly name: string;
  readonly persistentVolumeClaim: { readonly claimName: string };
}

/** Read-only, like the root filesystem, but for the state a service has to keep. */
export interface VolumeMount {
  readonly name: string;
  readonly mountPath: string;
  /** One file of the volume, mounted in place of the file at mountPath. */
  readonly subPath?: string;
  readonly readOnly: boolean;
}

export interface Probe {
  readonly exec: { readonly command: readonly string[] };
  readonly periodSeconds: number;
  readonly timeoutSeconds: number;
  readonly failureThreshold: number;
}

export interface SecurityContext {
  readonly runAsNonRoot: true;
  readonly runAsUser: number;
  readonly runAsGroup: number;
  readonly allowPrivilegeEscalation: false;
  readonly readOnlyRootFilesystem: true;
  readonly capabilities: { readonly drop: readonly ["ALL"] };
}
