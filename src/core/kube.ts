// The subset of Kubernetes objects Mayfly writes, with Kubernetes field names.

export interface Pod {
  readonly apiVersion: "v1";
  readonly kind: "Pod";
  readonly metadata: { readonly name: string };
  readonly spec: { readonly containers: readonly Container[] };
}

export interface ConfigMap {
  readonly apiVersion: "v1";
  readonly kind: "ConfigMap";
  readonly metadata: { readonly name: string };
  readonly data: Readonly<Record<string, string>>;
}

/** Every container Mayfly writes is health-checked, hardened and capped. */
export interface Container {
  readonly name: string;
  readonly image: string;
  readonly args?: readonly string[];
  readonly env?: readonly EnvVar[];
  readonly ports?: readonly ContainerPort[];
  readonly livenessProbe: Probe;
  readonly securityContext: SecurityContext;
  readonly resources: { readonly limits: { readonly cpu: string; readonly memory: string } };
}

export type EnvVar =
  | { readonly name: string; readonly value: string }
  | { readonly name: string; readonly valueFrom: EnvVarSource };

/** Exactly one is set. */
export interface EnvVarSource {
  readonly configMapKeyRef?: KeyRef;
  readonly secretKeyRef?: KeyRef;
}

export interface KeyRef {
  readonly name: string;
  readonly key: string;
}

export interface ContainerPort {
  readonly containerPort: number;
  readonly hostPort: number;
  readonly hostIP: string;
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
