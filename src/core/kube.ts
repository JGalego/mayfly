// The subset of Kubernetes objects Mayfly writes, with Kubernetes field names.

export interface Pod {
  readonly apiVersion: "v1";
  readonly kind: "Pod";
  readonly metadata: { readonly name: string };
  readonly spec: { readonly containers: readonly Container[]; readonly volumes?: readonly SecretVolume[] };
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

export type KubeObject = Pod | ConfigMap | Secret;

/** Every container Mayfly writes is health-checked, hardened and capped. */
export interface Container {
  readonly name: string;
  readonly image: string;
  readonly imagePullPolicy?: "IfNotPresent";
  readonly args?: readonly string[];
  readonly env?: readonly EnvVar[];
  readonly envFrom?: readonly { readonly configMapRef: { readonly name: string } }[];
  readonly ports?: readonly ContainerPort[];
  readonly volumeMounts?: readonly VolumeMount[];
  readonly livenessProbe: Probe;
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

export interface SecretVolume {
  readonly name: string;
  readonly secret: { readonly secretName: string };
}

/** Always read-only, like the root filesystem. */
export interface VolumeMount {
  readonly name: string;
  readonly mountPath: string;
  readonly readOnly: true;
}

export interface Probe {
  readonly httpGet: { readonly path: string; readonly port: number };
}

export interface SecurityContext {
  readonly runAsNonRoot: true;
  readonly runAsUser: number;
  readonly runAsGroup: number;
  readonly allowPrivilegeEscalation: false;
  readonly readOnlyRootFilesystem: true;
  readonly capabilities: { readonly drop: readonly ["ALL"] };
}
