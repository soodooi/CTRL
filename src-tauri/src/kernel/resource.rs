//! Canonical resource identity and ownership contracts.
//!
//! A `ResourceRef` is a logical capability address. It is not a filesystem path
//! or a network URL. Native resolution stays inside the registered owner.
//! (ADR-002 substrate §15 v83)

use async_trait::async_trait;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::{
    collections::HashMap,
    fmt,
    str::FromStr,
    sync::{Arc, RwLock},
};
use thiserror::Error;
use unicode_normalization::UnicodeNormalization;

const MAX_REF_BYTES: usize = 4096;
const MAX_KIND_BYTES: usize = 64;
const MAX_ID_SEGMENTS: usize = 32;
const MAX_SEGMENT_BYTES: usize = 255;
const MAX_REVISION_BYTES: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResourceAuthority {
    Local,
    App,
    Pack,
    Connector,
}

impl ResourceAuthority {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::App => "app",
            Self::Pack => "pack",
            Self::Connector => "connector",
        }
    }
}

impl fmt::Display for ResourceAuthority {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for ResourceAuthority {
    type Err = ResourceRefParseError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "local" => Ok(Self::Local),
            "app" => Ok(Self::App),
            "pack" => Ok(Self::Pack),
            "connector" => Ok(Self::Connector),
            _ => Err(ResourceRefParseError::UnknownAuthority),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ResourceRef {
    authority: ResourceAuthority,
    kind: String,
    id_segments: Vec<String>,
    revision: Option<String>,
}

impl ResourceRef {
    pub fn authority(&self) -> ResourceAuthority {
        self.authority
    }

    pub fn kind(&self) -> &str {
        &self.kind
    }

    pub fn id_segments(&self) -> &[String] {
        &self.id_segments
    }

    pub fn revision(&self) -> Option<&str> {
        self.revision.as_deref()
    }

    pub fn without_revision(&self) -> Self {
        Self {
            authority: self.authority,
            kind: self.kind.clone(),
            id_segments: self.id_segments.clone(),
            revision: None,
        }
    }
}

impl FromStr for ResourceRef {
    type Err = ResourceRefParseError;

    fn from_str(input: &str) -> Result<Self, Self::Err> {
        if input.len() > MAX_REF_BYTES {
            return Err(ResourceRefParseError::RefTooLong);
        }
        if input.bytes().any(|byte| byte.is_ascii_control()) {
            return Err(ResourceRefParseError::ControlCharacter);
        }
        if input.contains('#') {
            return Err(ResourceRefParseError::FragmentNotAllowed);
        }

        let remainder = input
            .strip_prefix("ctrl://")
            .ok_or(ResourceRefParseError::InvalidScheme)?;
        if remainder.matches('?').count() > 1 {
            return Err(ResourceRefParseError::InvalidQuery);
        }
        let (path, revision) = match remainder.split_once('?') {
            Some((path, query)) => {
                let encoded = query
                    .strip_prefix("rev=")
                    .ok_or(ResourceRefParseError::InvalidQuery)?;
                if encoded.is_empty() || encoded.contains('&') || encoded.contains('=') {
                    return Err(ResourceRefParseError::InvalidQuery);
                }
                let revision = decode_component(encoded, ComponentRole::Revision)?;
                if revision.len() > MAX_REVISION_BYTES {
                    return Err(ResourceRefParseError::RevisionTooLong);
                }
                (path, Some(revision))
            }
            None => (remainder, None),
        };

        let (authority_text, resource_path) = path
            .split_once('/')
            .ok_or(ResourceRefParseError::MissingResourcePath)?;
        if authority_text.contains('@') {
            return Err(ResourceRefParseError::CredentialsNotAllowed);
        }
        let authority = authority_text.parse()?;
        let (kind, encoded_id) = resource_path
            .split_once('/')
            .ok_or(ResourceRefParseError::MissingResourcePath)?;
        validate_kind(kind)?;

        let encoded_segments: Vec<&str> = encoded_id.split('/').collect();
        if encoded_segments.is_empty() || encoded_segments.len() > MAX_ID_SEGMENTS {
            return Err(ResourceRefParseError::InvalidSegmentCount);
        }
        let mut id_segments = Vec::with_capacity(encoded_segments.len());
        for encoded in encoded_segments {
            let segment = decode_component(encoded, ComponentRole::IdSegment)?;
            if segment.len() > MAX_SEGMENT_BYTES {
                return Err(ResourceRefParseError::SegmentTooLong);
            }
            id_segments.push(segment);
        }

        let resource_ref = Self {
            authority,
            kind: kind.to_owned(),
            id_segments,
            revision,
        };
        if resource_ref.to_string().len() > MAX_REF_BYTES {
            return Err(ResourceRefParseError::RefTooLong);
        }
        Ok(resource_ref)
    }
}

impl fmt::Display for ResourceRef {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "ctrl://{}/{}/", self.authority, self.kind)?;
        for (index, segment) in self.id_segments.iter().enumerate() {
            if index > 0 {
                formatter.write_str("/")?;
            }
            formatter.write_str(&encode_component(segment))?;
        }
        if let Some(revision) = &self.revision {
            write!(formatter, "?rev={}", encode_component(revision))?;
        }
        Ok(())
    }
}

impl Serialize for ResourceRef {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for ResourceRef {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        value.parse().map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, Copy)]
enum ComponentRole {
    IdSegment,
    Revision,
}

fn validate_kind(kind: &str) -> Result<(), ResourceRefParseError> {
    if kind.is_empty() || kind.len() > MAX_KIND_BYTES {
        return Err(ResourceRefParseError::InvalidKindLength);
    }
    if !kind
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(ResourceRefParseError::InvalidKindCharacter);
    }
    Ok(())
}

fn decode_component(encoded: &str, role: ComponentRole) -> Result<String, ResourceRefParseError> {
    if encoded.is_empty() {
        return Err(ResourceRefParseError::EmptyComponent);
    }
    if !encoded.is_ascii() {
        return Err(ResourceRefParseError::RawNonAscii);
    }

    let input = encoded.as_bytes();
    let mut decoded = Vec::with_capacity(input.len());
    let mut index = 0;
    while index < input.len() {
        let byte = input[index];
        if byte == b'%' {
            if index + 2 >= input.len() {
                return Err(ResourceRefParseError::MalformedPercentEscape);
            }
            let high =
                hex_value(input[index + 1]).ok_or(ResourceRefParseError::MalformedPercentEscape)?;
            let low =
                hex_value(input[index + 2]).ok_or(ResourceRefParseError::MalformedPercentEscape)?;
            let value = (high << 4) | low;
            if matches!(value, b'/' | b'\\') {
                return Err(ResourceRefParseError::EncodedSeparator);
            }
            decoded.push(value);
            index += 3;
        } else {
            if !is_unreserved(byte) {
                return Err(if byte == b'\\' {
                    ResourceRefParseError::DecodedSeparator
                } else {
                    ResourceRefParseError::InvalidLiteralCharacter
                });
            }
            decoded.push(byte);
            index += 1;
        }
    }

    let decoded = String::from_utf8(decoded).map_err(|_| ResourceRefParseError::InvalidUtf8)?;
    if decoded.chars().any(char::is_control) {
        return Err(ResourceRefParseError::ControlCharacter);
    }
    let normalized: String = decoded.nfc().collect();
    if normalized.is_empty() {
        return Err(ResourceRefParseError::EmptyComponent);
    }
    if normalized.contains('/') || normalized.contains('\\') {
        return Err(ResourceRefParseError::DecodedSeparator);
    }
    if matches!(role, ComponentRole::IdSegment) && matches!(normalized.as_str(), "." | "..") {
        return Err(ResourceRefParseError::DotSegment);
    }
    Ok(normalized)
}

fn encode_component(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        if is_unreserved(*byte) {
            encoded.push(char::from(*byte));
        } else {
            encoded.push('%');
            encoded.push(char::from(HEX[(byte >> 4) as usize]));
            encoded.push(char::from(HEX[(byte & 0x0f) as usize]));
        }
    }
    encoded
}

fn is_unreserved(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~')
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ResourceRefParseError {
    #[error("resource reference exceeds 4096 bytes")]
    RefTooLong,
    #[error("resource reference must use the ctrl scheme")]
    InvalidScheme,
    #[error("resource reference authority is unknown")]
    UnknownAuthority,
    #[error("resource reference credentials are not allowed")]
    CredentialsNotAllowed,
    #[error("resource reference fragment is not allowed")]
    FragmentNotAllowed,
    #[error("resource reference query must be a single rev value")]
    InvalidQuery,
    #[error("resource reference path is incomplete")]
    MissingResourcePath,
    #[error("resource kind must contain 1 to 64 ASCII bytes")]
    InvalidKindLength,
    #[error("resource kind contains an invalid character")]
    InvalidKindCharacter,
    #[error("resource reference must contain 1 to 32 id segments")]
    InvalidSegmentCount,
    #[error("resource reference component is empty")]
    EmptyComponent,
    #[error("resource reference segment exceeds 255 bytes")]
    SegmentTooLong,
    #[error("resource reference revision exceeds 256 bytes")]
    RevisionTooLong,
    #[error("resource reference contains a malformed percent escape")]
    MalformedPercentEscape,
    #[error("resource reference contains an encoded separator")]
    EncodedSeparator,
    #[error("resource reference contains a separator inside a component")]
    DecodedSeparator,
    #[error("resource reference contains a dot segment")]
    DotSegment,
    #[error("resource reference contains invalid UTF-8")]
    InvalidUtf8,
    #[error("resource reference contains a control character")]
    ControlCharacter,
    #[error("resource reference contains raw non-ASCII text")]
    RawNonAscii,
    #[error("resource reference contains a non-canonical literal character")]
    InvalidLiteralCharacter,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ResourceDescriptor {
    pub protocol_version: String,
    pub resource: ResourceRef,
    pub content_type: String,
    #[serde(default)]
    pub provenance: Vec<ResourceRef>,
    pub freshness: ResourceFreshness,
    pub degradation: Option<ResourceDegradation>,
    pub presentation: PresentationHints,
    pub query: QueryContract,
    #[serde(default)]
    pub produce: Vec<ProduceOperationDescriptor>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResourceFreshness {
    pub observed_at: Option<String>,
    pub revision: Option<String>,
    pub stale: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResourceDegradation {
    pub code: String,
    pub summary: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PresentationHints {
    pub viewer: Option<String>,
    pub title: Option<String>,
    #[serde(default)]
    pub preferred_columns: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct QueryContract {
    pub request_schema: serde_json::Value,
    pub result_schema: serde_json::Value,
    pub watchable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProduceOperationDescriptor {
    pub kind: String,
    pub input_schema: serde_json::Value,
    pub result_schema: serde_json::Value,
    pub review_required: bool,
    pub recovery: OperationRecoveryPolicy,
    pub retention_seconds: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationRecoveryPolicy {
    Durable,
    RestartRecoveryUnsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OperationRef {
    pub operation_id: String,
    pub resource: ResourceRef,
    pub operation_kind: String,
    pub idempotency_key: String,
    pub created_at: String,
    pub state: OperationState,
    pub retention_seconds: u64,
    pub expires_at: Option<String>,
    pub recovery: OperationRecoveryPolicy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationState {
    Queued,
    AwaitingReview,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Feedback {
    pub code: String,
    pub message: String,
    pub severity: FeedbackSeverity,
    pub field: Option<String>,
    pub retryable: bool,
    #[serde(default)]
    pub details: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FeedbackSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceUnavailableReason {
    Expired,
    ExpiredAlias,
    RestartRecoveryUnsupported,
    OwnerUnavailable,
    PlatformPrimitiveUnavailable,
    RevisionUnavailable,
    PayloadTooLarge,
}

#[derive(Debug, Error)]
pub enum ResourceError {
    #[error(transparent)]
    InvalidRef(#[from] ResourceRefParseError),
    #[error("resource owner already exists for {authority}/{kind}")]
    OwnerCollision {
        authority: ResourceAuthority,
        kind: String,
    },
    #[error("only the kernel may register a local resource owner")]
    LocalAuthorityReserved,
    #[error("resource owner is unavailable")]
    OwnerNotFound,
    #[error("resource access was denied")]
    Denied,
    #[error("resource is unavailable: {reason:?}")]
    Unavailable {
        reason: ResourceUnavailableReason,
        retryable: bool,
    },
    #[error("resource owner returned a descriptor for a different identity")]
    DescriptorIdentityMismatch,
    #[error("resource operation descriptor changed after preparation")]
    DescriptorChanged,
    #[error("resource payload does not match its descriptor schema: {message}")]
    InvalidPayload { message: String },
    #[error("resource operation is not supported")]
    UnsupportedOperation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceAccessContext {
    pub caller: String,
    pub capability_scope: Vec<String>,
}

/// The proposed before/after for a mutation that has not been committed. Owned
/// by the owner staging the change; a caller may render it but never derive it.
/// (ADR-002 substrate §15.5 v86)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OutcomeStagedChange {
    pub before: String,
    pub after: String,
}

/// What the operation depends on remaining true at execution time.
/// (ADR-002 substrate §15.5 v86)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OutcomePrecondition {
    pub label: String,
    pub value: String,
}

/// What became true after a committed mutation, plus the verification the owner
/// actually performed. An owner that cannot verify reports that honestly rather
/// than claiming success. (ADR-002 substrate §15.5 v86)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OutcomeEffect {
    pub summary: String,
    /// How the owner confirmed the committed state, e.g. a post-write reread.
    pub verified_by: Option<String>,
}

/// The typed result of an operation. Replaces reducing an owner's typed failure
/// to a message string at a boundary, which discards code, retryability, field
/// identity, and correction. (ADR-002 substrate §15.5 v86)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Outcome {
    pub resource: ResourceRef,
    /// Owner-meaningful coordinates within the resource; never a filesystem
    /// path or owner internal.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staged: Option<OutcomeStagedChange>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub preconditions: Vec<OutcomePrecondition>,
    /// Canonical refs for drill-down, matching the descriptor's provenance
    /// shape rather than introducing a second one.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub provenance: Vec<ResourceRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effect: Option<OutcomeEffect>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feedback: Option<Feedback>,
    /// The owner's own result payload, typed by its descriptor schema.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
}

impl Outcome {
    /// A staged, not-yet-committed mutation. This is the shape a review request
    /// must be built from. (ADR-002 substrate §15.5.3 v86)
    pub fn staged(resource: ResourceRef, target: impl Into<String>, before: impl Into<String>, after: impl Into<String>) -> Self {
        Self {
            resource,
            target: Some(target.into()),
            staged: Some(OutcomeStagedChange {
                before: before.into(),
                after: after.into(),
            }),
            preconditions: Vec::new(),
            provenance: Vec::new(),
            effect: None,
            feedback: None,
            result: None,
        }
    }

    pub fn with_precondition(mut self, label: impl Into<String>, value: impl Into<String>) -> Self {
        self.preconditions.push(OutcomePrecondition {
            label: label.into(),
            value: value.into(),
        });
        self
    }

    /// Record the committed effect together with how it was verified. A success
    /// claim without verification is not permitted by §15.5.2, so callers that
    /// cannot verify pass `None` and the outcome reads as unverified.
    pub fn committed(
        mut self,
        summary: impl Into<String>,
        verified_by: Option<String>,
    ) -> Self {
        self.effect = Some(OutcomeEffect {
            summary: summary.into(),
            verified_by,
        });
        self
    }

    /// Whether this outcome may be reported to the user as a completed mutation.
    /// (ADR-002 substrate §15.5.2 v86)
    pub fn is_verified_success(&self) -> bool {
        self.feedback.is_none()
            && self
                .effect
                .as_ref()
                .is_some_and(|effect| effect.verified_by.is_some())
    }

    /// The facts a ReviewGate request must carry for a canonical `produce`.
    /// Returns None when the owner staged nothing, which is precisely the fact
    /// deficit §15.5.3 exists to make visible rather than paper over.
    pub fn review_facts(&self) -> Option<ReviewOutcomeFacts> {
        let staged = self.staged.as_ref()?;
        Some(ReviewOutcomeFacts {
            resource: self.resource.to_string(),
            target: self.target.clone(),
            before: staged.before.clone(),
            after: staged.after.clone(),
            preconditions: self.preconditions.clone(),
        })
    }
}

/// Gate-derived approval facts projected from a prepared Outcome. Carries what
/// will change; never caller or model prose, and never who may approve.
/// (ADR-002 substrate §15.5.3 v86)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReviewOutcomeFacts {
    pub resource: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    pub before: String,
    pub after: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub preconditions: Vec<OutcomePrecondition>,
}

#[async_trait]
pub trait ResourceOwner: Send + Sync {
    async fn describe(
        &self,
        context: &ResourceAccessContext,
        resource: &ResourceRef,
    ) -> Result<ResourceDescriptor, ResourceError>;

    async fn query(
        &self,
        _context: &ResourceAccessContext,
        _resource: &ResourceRef,
        _request: serde_json::Value,
    ) -> Result<serde_json::Value, ResourceError> {
        Err(ResourceError::UnsupportedOperation)
    }

    /// Stage a mutation without committing it, returning the Outcome facts a
    /// review request must be built from. An owner that cannot stage is not
    /// review-eligible for that operation.
    /// (ADR-002 substrate §15.2 v87; §15.5.3 v86)
    async fn stage(
        &self,
        _context: &ResourceAccessContext,
        _resource: &ResourceRef,
        _operation: serde_json::Value,
    ) -> Result<Outcome, ResourceError> {
        Err(ResourceError::UnsupportedOperation)
    }

    async fn produce(
        &self,
        _context: &ResourceAccessContext,
        _resource: &ResourceRef,
        _operation: serde_json::Value,
    ) -> Result<serde_json::Value, ResourceError> {
        Err(ResourceError::UnsupportedOperation)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RegistrationOrigin {
    Kernel,
    TrustedApplication,
    FeaturePack,
    Connector,
}

#[derive(Clone)]
pub struct OwnerRegistration {
    pub authority: ResourceAuthority,
    pub kind: String,
    pub origin: RegistrationOrigin,
    pub owner_label: String,
    pub owner: Arc<dyn ResourceOwner>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct OwnerKey {
    authority: ResourceAuthority,
    kind: String,
}

#[derive(Default)]
pub struct ResourceRegistry {
    owners: RwLock<HashMap<OwnerKey, OwnerRegistration>>,
}

/// A schema-valid operation bound to the exact owner/descriptor snapshot that
/// authorized it. ReviewGate may pause between preparation and execution
/// without re-resolving a different owner or schema.
/// (ADR-002 substrate §15 v83)
pub struct PreparedProduce {
    owner: Arc<dyn ResourceOwner>,
    resource: ResourceRef,
    operation: serde_json::Value,
    operation_descriptor: ProduceOperationDescriptor,
}

impl PreparedProduce {
    /// Gate-derived approval facts for this prepared operation. `None` means the
    /// owner staged nothing, which the gate must surface as a fact deficit rather
    /// than substitute with a tool name and argument dump.
    /// (ADR-002 substrate §15.5.3 v86; §15.2 v87)
    pub async fn review_facts(
        &self,
        context: &ResourceAccessContext,
    ) -> Option<ReviewOutcomeFacts> {
        self.owner
            .stage(context, &self.resource, self.operation.clone())
            .await
            .ok()
            .and_then(|outcome| outcome.review_facts())
    }

    pub async fn execute(
        self,
        context: &ResourceAccessContext,
    ) -> Result<serde_json::Value, ResourceError> {
        let descriptor = self.owner.describe(context, &self.resource).await?;
        ensure_descriptor_identity(&self.resource, &descriptor)?;
        let current_operation = descriptor
            .produce
            .iter()
            .find(|candidate| candidate.kind == self.operation_descriptor.kind)
            .ok_or(ResourceError::DescriptorChanged)?;
        if current_operation != &self.operation_descriptor {
            return Err(ResourceError::DescriptorChanged);
        }
        let result = self
            .owner
            .produce(context, &self.resource, self.operation)
            .await?;
        validate_payload(&self.operation_descriptor.result_schema, &result)?;
        Ok(result)
    }
}

impl ResourceRegistry {
    pub fn register(&self, registration: OwnerRegistration) -> Result<(), ResourceError> {
        validate_kind(&registration.kind)?;
        if registration.authority == ResourceAuthority::Local
            && registration.origin != RegistrationOrigin::Kernel
        {
            return Err(ResourceError::LocalAuthorityReserved);
        }

        let key = OwnerKey {
            authority: registration.authority,
            kind: registration.kind.clone(),
        };
        let mut owners = self
            .owners
            .write()
            .unwrap_or_else(|error| error.into_inner());
        if owners.contains_key(&key) {
            return Err(ResourceError::OwnerCollision {
                authority: key.authority,
                kind: key.kind,
            });
        }
        owners.insert(key, registration);
        Ok(())
    }

    pub async fn describe(
        &self,
        context: &ResourceAccessContext,
        resource: &ResourceRef,
    ) -> Result<ResourceDescriptor, ResourceError> {
        let registration = self.registration_for(resource)?;
        let descriptor = registration.owner.describe(context, resource).await?;
        ensure_descriptor_identity(resource, &descriptor)?;
        Ok(descriptor)
    }

    pub async fn query(
        &self,
        context: &ResourceAccessContext,
        resource: &ResourceRef,
        request: serde_json::Value,
    ) -> Result<serde_json::Value, ResourceError> {
        let registration = self.registration_for(resource)?;
        let descriptor = registration.owner.describe(context, resource).await?;
        ensure_descriptor_identity(resource, &descriptor)?;
        validate_payload(&descriptor.query.request_schema, &request)?;
        let result = registration.owner.query(context, resource, request).await?;
        validate_payload(&descriptor.query.result_schema, &result)?;
        Ok(result)
    }

    pub async fn prepare_produce(
        &self,
        context: &ResourceAccessContext,
        resource: &ResourceRef,
        operation: serde_json::Value,
    ) -> Result<PreparedProduce, ResourceError> {
        let registration = self.registration_for(resource)?;
        let descriptor = registration.owner.describe(context, resource).await?;
        ensure_descriptor_identity(resource, &descriptor)?;
        let kind = operation
            .get("kind")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| ResourceError::InvalidPayload {
                message: "operation requires a string kind".to_owned(),
            })?;
        let operation_descriptor = descriptor
            .produce
            .iter()
            .find(|candidate| candidate.kind == kind)
            .ok_or(ResourceError::UnsupportedOperation)?;
        validate_payload(&operation_descriptor.input_schema, &operation)?;
        Ok(PreparedProduce {
            owner: registration.owner,
            resource: resource.clone(),
            operation,
            operation_descriptor: operation_descriptor.clone(),
        })
    }

    pub async fn produce(
        &self,
        context: &ResourceAccessContext,
        resource: &ResourceRef,
        operation: serde_json::Value,
    ) -> Result<serde_json::Value, ResourceError> {
        self.prepare_produce(context, resource, operation)
            .await?
            .execute(context)
            .await
    }

    pub fn owner_count(&self) -> usize {
        self.owners
            .read()
            .unwrap_or_else(|error| error.into_inner())
            .len()
    }

    fn registration_for(&self, resource: &ResourceRef) -> Result<OwnerRegistration, ResourceError> {
        let key = OwnerKey {
            authority: resource.authority,
            kind: resource.kind.clone(),
        };
        self.owners
            .read()
            .unwrap_or_else(|error| error.into_inner())
            .get(&key)
            .cloned()
            .ok_or(ResourceError::OwnerNotFound)
    }
}

fn ensure_descriptor_identity(
    resource: &ResourceRef,
    descriptor: &ResourceDescriptor,
) -> Result<(), ResourceError> {
    if descriptor.resource != *resource {
        return Err(ResourceError::DescriptorIdentityMismatch);
    }
    Ok(())
}

fn validate_payload(
    schema: &serde_json::Value,
    payload: &serde_json::Value,
) -> Result<(), ResourceError> {
    let validator = jsonschema::options()
        .with_draft(jsonschema::Draft::Draft202012)
        .build(schema)
        .map_err(|_| ResourceError::InvalidPayload {
            message: "owner descriptor contains an invalid schema".to_owned(),
        })?;
    validator
        .validate(payload)
        .map_err(|error| ResourceError::InvalidPayload {
            message: error.to_string(),
        })
}

#[cfg(test)]
mod prepared_review_tests {
    use super::*;
    use crate::kernel::note_resource::MarkdownNoteOwner;

    fn registry_with_notes(root: std::path::PathBuf, recovery: std::path::PathBuf) -> ResourceRegistry {
        let registry = ResourceRegistry::default();
        registry
            .register(OwnerRegistration {
                authority: ResourceAuthority::Local,
                kind: "note".to_owned(),
                origin: RegistrationOrigin::Kernel,
                owner_label: "test-note".to_owned(),
                owner: Arc::new(MarkdownNoteOwner::new(root).with_recovery_root(recovery)),
            })
            .expect("register note owner");
        registry
    }

    fn context() -> ResourceAccessContext {
        ResourceAccessContext {
            caller: "hermes".to_owned(),
            capability_scope: vec!["notes".to_owned()],
        }
    }

    /// The facts a review request carries come from the prepared owner Outcome,
    /// and preparing one writes nothing. (ADR-002 substrate §15.5.3 v86; §15.2 v87)
    #[tokio::test]
    async fn a_prepared_write_yields_review_facts_without_touching_the_file() {
        let temporary = tempfile::tempdir().expect("temporary vault");
        let note = temporary.path().join("note.md");
        std::fs::write(&note, "# Today\n").expect("write note");
        let registry = registry_with_notes(
            temporary.path().to_path_buf(),
            temporary.path().join("recovery"),
        );
        let resource: ResourceRef = "ctrl://local/note/note.md".parse().unwrap();

        let descriptor = registry
            .describe(&context(), &resource)
            .await
            .expect("describe");
        let revision = descriptor.freshness.revision.clone().expect("revision");

        let prepared = registry
            .prepare_produce(
                &context(),
                &resource,
                serde_json::json!({
                    "kind": "replace_content",
                    "expected_revision": revision,
                    "content": "# Rewritten\n"
                }),
            )
            .await
            .expect("prepare");
        let facts = prepared
            .review_facts(&context())
            .await
            .expect("prepared write carries staged facts");
        assert_eq!(facts.before, "# Today\n");
        assert_eq!(facts.after, "# Rewritten\n");
        assert_eq!(facts.target.as_deref(), Some("note.md"));
        assert_eq!(facts.preconditions.len(), 1);
        assert_eq!(
            std::fs::read_to_string(&note).expect("note"),
            "# Today\n",
            "preparing a review must not write"
        );

        // Executing the same prepared operation commits and verifies.
        let result = prepared.execute(&context()).await.expect("execute");
        assert_eq!(
            result["effect"]["verified_by"],
            "post-write reread matched the expected revision"
        );
        assert_eq!(std::fs::read_to_string(&note).expect("note"), "# Rewritten\n");
    }

    /// A stale expected revision produces no review facts, so the gate cannot
    /// present a change that would not apply.
    #[tokio::test]
    async fn a_stale_expected_revision_yields_no_review_facts() {
        let temporary = tempfile::tempdir().expect("temporary vault");
        std::fs::write(temporary.path().join("note.md"), "# Today\n").expect("write note");
        let registry = registry_with_notes(
            temporary.path().to_path_buf(),
            temporary.path().join("recovery"),
        );
        let resource: ResourceRef = "ctrl://local/note/note.md".parse().unwrap();
        let prepared = registry
            .prepare_produce(
                &context(),
                &resource,
                serde_json::json!({
                    "kind": "replace_content",
                    "expected_revision": "0".repeat(64),
                    "content": "# Rewritten\n"
                }),
            )
            .await
            .expect("prepare");
        assert!(prepared.review_facts(&context()).await.is_none());
    }
}

#[cfg(test)]
mod outcome_tests {
    use super::*;

    fn note_ref() -> ResourceRef {
        "ctrl://local/note/daily/2026-08-05.md"
            .parse()
            .expect("canonical note ref")
    }

    #[test]
    fn staged_outcome_projects_review_facts() {
        // A review request must be built from what will change, not from a tool
        // name plus an argument summary. (ADR-002 substrate §15.5.3 v86)
        let outcome = Outcome::staged(note_ref(), "## Overview", "old body", "new body")
            .with_precondition("Revision", "rev-0182")
            .with_precondition("Hash", "54ae8f21");
        let facts = outcome
            .review_facts()
            .expect("staged outcome has review facts");
        assert_eq!(facts.target.as_deref(), Some("## Overview"));
        assert_eq!(facts.before, "old body");
        assert_eq!(facts.after, "new body");
        assert_eq!(facts.preconditions.len(), 2);
        assert!(facts.resource.starts_with("ctrl://local/note/"));
    }

    #[test]
    fn an_outcome_with_nothing_staged_exposes_the_fact_deficit() {
        // Returning None is deliberate: a caller must not invent a diff, and the
        // missing fact is the owner's to supply. (ADR-002 §15.5.2 v86)
        let outcome = Outcome {
            resource: note_ref(),
            target: None,
            staged: None,
            preconditions: Vec::new(),
            provenance: Vec::new(),
            effect: None,
            feedback: None,
            result: None,
        };
        assert!(outcome.review_facts().is_none());
    }

    #[test]
    fn success_requires_owner_verification() {
        let unverified = Outcome::staged(note_ref(), "## Overview", "old", "new")
            .committed("replaced the Overview section", None);
        assert!(
            !unverified.is_verified_success(),
            "an unverified commit must not read as success"
        );

        let verified = Outcome::staged(note_ref(), "## Overview", "old", "new").committed(
            "replaced the Overview section",
            Some("post-write reread".to_owned()),
        );
        assert!(verified.is_verified_success());
    }

    #[test]
    fn failure_is_never_reported_as_success() {
        let failed = Outcome {
            feedback: Some(Feedback {
                code: "precondition_failed".to_owned(),
                message: "revision moved".to_owned(),
                severity: FeedbackSeverity::Error,
                field: None,
                retryable: true,
                details: serde_json::Map::new(),
            }),
            ..Outcome::staged(note_ref(), "## Overview", "old", "new")
                .committed("wrote", Some("reread".to_owned()))
        };
        assert!(!failed.is_verified_success());
    }

    #[test]
    fn typed_failure_preserves_retryability_across_serialization() {
        // The point of §15.5: `code` and `retryable` survive the boundary instead
        // of collapsing into one human sentence.
        let outcome = Outcome {
            feedback: Some(Feedback {
                code: "resource_unavailable".to_owned(),
                message: "owner unavailable".to_owned(),
                severity: FeedbackSeverity::Error,
                field: Some("path".to_owned()),
                retryable: true,
                details: serde_json::Map::new(),
            }),
            ..Outcome::staged(note_ref(), "## Overview", "old", "new")
        };
        let json = serde_json::to_value(&outcome).expect("serializable");
        assert_eq!(json["feedback"]["code"], "resource_unavailable");
        assert_eq!(json["feedback"]["retryable"], true);
        assert_eq!(json["feedback"]["field"], "path");
        // Absent facts are omitted rather than emitted as empty values a caller
        // could mistake for real ones.
        assert!(json.get("effect").is_none());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(value: &str) -> ResourceRef {
        value.parse().expect("valid resource reference")
    }

    #[test]
    fn canonicalizes_percent_encoding_and_unicode_nfc() {
        let composed = parse("ctrl://local/note/caf%c3%a9/%7eitem?rev=r%c3%a9v");
        let decomposed = parse("ctrl://local/note/cafe%CC%81/~item?rev=re%CC%81v");

        assert_eq!(composed, decomposed);
        assert_eq!(
            composed.to_string(),
            "ctrl://local/note/caf%C3%A9/~item?rev=r%C3%A9v"
        );
    }

    #[test]
    fn serde_uses_only_the_canonical_string() {
        let resource = parse("ctrl://pack/table/a%20b");
        let json = serde_json::to_string(&resource).expect("serialize resource reference");
        assert_eq!(json, "\"ctrl://pack/table/a%20b\"");
        assert_eq!(
            serde_json::from_str::<ResourceRef>(&json).expect("deserialize resource reference"),
            resource
        );
    }

    #[test]
    fn rejects_ambiguous_or_unsafe_inputs() {
        let invalid = [
            "http://local/note/a",
            "ctrl://user@local/note/a",
            "ctrl://LOCAL/note/a",
            "ctrl://local/note/a#fragment",
            "ctrl://local/note/a?other=x",
            "ctrl://local/note/a?rev=x&rev=y",
            "ctrl://local/note/a?rev=x?rev=y",
            "ctrl://local/note/a/",
            "ctrl://local/note/.",
            "ctrl://local/note/%2e%2e",
            "ctrl://local/note/a%2fb",
            "ctrl://local/note/a%5Cb",
            "ctrl://local/note/a\\b",
            "ctrl://local/note/%00",
            "ctrl://local/note/%",
            "ctrl://local/note/%GG",
            "ctrl://local/no%74e/a",
            "ctrl://local/note/café",
        ];

        for value in invalid {
            assert!(value.parse::<ResourceRef>().is_err(), "accepted {value}");
        }
    }

    #[test]
    fn enforces_every_bounded_field() {
        let long_ref = format!("ctrl://local/note/{}", "a".repeat(MAX_REF_BYTES));
        assert_eq!(
            long_ref.parse::<ResourceRef>(),
            Err(ResourceRefParseError::RefTooLong)
        );

        let long_kind = format!("ctrl://local/{}/a", "k".repeat(MAX_KIND_BYTES + 1));
        assert_eq!(
            long_kind.parse::<ResourceRef>(),
            Err(ResourceRefParseError::InvalidKindLength)
        );

        let too_many_segments = format!(
            "ctrl://local/note/{}",
            vec!["a"; MAX_ID_SEGMENTS + 1].join("/")
        );
        assert_eq!(
            too_many_segments.parse::<ResourceRef>(),
            Err(ResourceRefParseError::InvalidSegmentCount)
        );

        let long_segment = format!("ctrl://local/note/{}", "a".repeat(MAX_SEGMENT_BYTES + 1));
        assert_eq!(
            long_segment.parse::<ResourceRef>(),
            Err(ResourceRefParseError::SegmentTooLong)
        );

        let long_revision = format!(
            "ctrl://local/note/a?rev={}",
            "r".repeat(MAX_REVISION_BYTES + 1)
        );
        assert_eq!(
            long_revision.parse::<ResourceRef>(),
            Err(ResourceRefParseError::RevisionTooLong)
        );
    }

    struct TestOwner;

    #[async_trait]
    impl ResourceOwner for TestOwner {
        async fn describe(
            &self,
            _context: &ResourceAccessContext,
            resource: &ResourceRef,
        ) -> Result<ResourceDescriptor, ResourceError> {
            Ok(ResourceDescriptor {
                protocol_version: "1".to_owned(),
                resource: resource.clone(),
                content_type: "text/markdown".to_owned(),
                provenance: Vec::new(),
                freshness: ResourceFreshness {
                    observed_at: None,
                    revision: resource.revision().map(str::to_owned),
                    stale: false,
                },
                degradation: None,
                presentation: PresentationHints::default(),
                query: QueryContract {
                    request_schema: serde_json::json!({
                        "type": "object",
                        "additionalProperties": false
                    }),
                    result_schema: serde_json::json!({"type": "object"}),
                    watchable: false,
                },
                produce: Vec::new(),
            })
        }

        async fn query(
            &self,
            _context: &ResourceAccessContext,
            _resource: &ResourceRef,
            _request: serde_json::Value,
        ) -> Result<serde_json::Value, ResourceError> {
            Ok(serde_json::json!({"ok": true}))
        }
    }

    fn context() -> ResourceAccessContext {
        ResourceAccessContext {
            caller: "test".to_owned(),
            capability_scope: vec!["note".to_owned()],
        }
    }

    fn registration(
        authority: ResourceAuthority,
        origin: RegistrationOrigin,
        owner_label: &'static str,
    ) -> OwnerRegistration {
        OwnerRegistration {
            authority,
            kind: "note".to_owned(),
            origin,
            owner_label: owner_label.to_owned(),
            owner: Arc::new(TestOwner),
        }
    }

    #[test]
    fn registry_has_one_owner_and_never_overwrites_collisions() {
        let registry = ResourceRegistry::default();
        registry
            .register(registration(
                ResourceAuthority::Pack,
                RegistrationOrigin::FeaturePack,
                "first",
            ))
            .expect("register first owner");

        let error = registry
            .register(registration(
                ResourceAuthority::Pack,
                RegistrationOrigin::FeaturePack,
                "second",
            ))
            .expect_err("collision must fail");
        assert!(matches!(error, ResourceError::OwnerCollision { .. }));
        assert_eq!(registry.owner_count(), 1);
        assert_eq!(
            registry
                .registration_for(&parse("ctrl://pack/note/item"))
                .expect("existing registration")
                .owner_label,
            "first"
        );
    }

    #[test]
    fn registry_reserves_local_authority_for_the_kernel() {
        let registry = ResourceRegistry::default();
        for origin in [
            RegistrationOrigin::TrustedApplication,
            RegistrationOrigin::FeaturePack,
            RegistrationOrigin::Connector,
        ] {
            let error = registry
                .register(registration(ResourceAuthority::Local, origin, "untrusted"))
                .expect_err("non-kernel local owner must fail");
            assert!(matches!(error, ResourceError::LocalAuthorityReserved));
        }
        registry
            .register(registration(
                ResourceAuthority::Local,
                RegistrationOrigin::Kernel,
                "kernel",
            ))
            .expect("kernel may own local resources");
    }

    #[tokio::test]
    async fn registry_rejects_descriptor_identity_substitution() {
        struct SubstitutingOwner;
        #[async_trait]
        impl ResourceOwner for SubstitutingOwner {
            async fn describe(
                &self,
                context: &ResourceAccessContext,
                _resource: &ResourceRef,
            ) -> Result<ResourceDescriptor, ResourceError> {
                TestOwner
                    .describe(context, &parse("ctrl://pack/note/other"))
                    .await
            }
        }

        let registry = ResourceRegistry::default();
        registry
            .register(OwnerRegistration {
                authority: ResourceAuthority::Pack,
                kind: "note".to_owned(),
                origin: RegistrationOrigin::FeaturePack,
                owner_label: "substituting".to_owned(),
                owner: Arc::new(SubstitutingOwner),
            })
            .expect("register owner");
        assert!(matches!(
            registry
                .describe(&context(), &parse("ctrl://pack/note/requested"))
                .await,
            Err(ResourceError::DescriptorIdentityMismatch)
        ));
    }

    #[tokio::test]
    async fn registry_rejects_owner_results_outside_descriptor_schema() {
        struct InvalidResultOwner;
        #[async_trait]
        impl ResourceOwner for InvalidResultOwner {
            async fn describe(
                &self,
                context: &ResourceAccessContext,
                resource: &ResourceRef,
            ) -> Result<ResourceDescriptor, ResourceError> {
                let mut descriptor = TestOwner.describe(context, resource).await?;
                descriptor.query.result_schema = serde_json::json!({ "type": "string" });
                Ok(descriptor)
            }

            async fn query(
                &self,
                _context: &ResourceAccessContext,
                _resource: &ResourceRef,
                _request: serde_json::Value,
            ) -> Result<serde_json::Value, ResourceError> {
                Ok(serde_json::json!({ "not": "a string" }))
            }
        }

        let registry = ResourceRegistry::default();
        registry
            .register(OwnerRegistration {
                authority: ResourceAuthority::Pack,
                kind: "note".to_owned(),
                origin: RegistrationOrigin::FeaturePack,
                owner_label: "invalid-result".to_owned(),
                owner: Arc::new(InvalidResultOwner),
            })
            .unwrap();
        assert!(matches!(
            registry
                .query(
                    &context(),
                    &parse("ctrl://pack/note/item"),
                    serde_json::json!({})
                )
                .await,
            Err(ResourceError::InvalidPayload { .. })
        ));
    }

    #[tokio::test]
    async fn registry_validates_descriptor_schema_before_same_owner_query() {
        let registry = ResourceRegistry::default();
        registry
            .register(registration(
                ResourceAuthority::Pack,
                RegistrationOrigin::FeaturePack,
                "query-owner",
            ))
            .unwrap();
        let resource = parse("ctrl://pack/note/item");
        assert_eq!(
            registry
                .query(&context(), &resource, serde_json::json!({}))
                .await
                .unwrap(),
            serde_json::json!({"ok": true})
        );
        assert!(matches!(
            registry
                .query(
                    &context(),
                    &resource,
                    serde_json::json!({"unexpected": true})
                )
                .await,
            Err(ResourceError::InvalidPayload { .. })
        ));
        assert!(matches!(
            registry
                .produce(&context(), &resource, serde_json::json!({"kind": "write"}))
                .await,
            Err(ResourceError::UnsupportedOperation)
        ));
    }

    #[tokio::test]
    async fn prepared_produce_binds_validation_before_owner_execution() {
        use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

        struct ProducingOwner {
            executions: Arc<AtomicUsize>,
            descriptor_changed: Arc<AtomicBool>,
        }

        #[async_trait]
        impl ResourceOwner for ProducingOwner {
            async fn describe(
                &self,
                context: &ResourceAccessContext,
                resource: &ResourceRef,
            ) -> Result<ResourceDescriptor, ResourceError> {
                let mut descriptor = TestOwner.describe(context, resource).await?;
                descriptor.produce = vec![ProduceOperationDescriptor {
                    kind: "replace".to_owned(),
                    input_schema: serde_json::json!({
                        "type": "object",
                        "required": ["kind", "content"],
                        "properties": {
                            "kind": { "const": "replace" },
                            "content": { "type": "string" }
                        },
                        "additionalProperties": false
                    }),
                    result_schema: serde_json::json!({ "type": "object" }),
                    review_required: true,
                    recovery: OperationRecoveryPolicy::RestartRecoveryUnsupported,
                    retention_seconds: 0,
                }];
                if self.descriptor_changed.load(Ordering::SeqCst) {
                    descriptor.produce[0].result_schema = serde_json::json!({ "type": "string" });
                }
                Ok(descriptor)
            }

            async fn produce(
                &self,
                _context: &ResourceAccessContext,
                _resource: &ResourceRef,
                operation: serde_json::Value,
            ) -> Result<serde_json::Value, ResourceError> {
                self.executions.fetch_add(1, Ordering::SeqCst);
                if operation["content"] == "invalid-result" {
                    Ok(serde_json::json!("invalid"))
                } else {
                    Ok(operation)
                }
            }
        }

        let executions = Arc::new(AtomicUsize::new(0));
        let descriptor_changed = Arc::new(AtomicBool::new(false));
        let registry = ResourceRegistry::default();
        registry
            .register(OwnerRegistration {
                authority: ResourceAuthority::Pack,
                kind: "note".to_owned(),
                origin: RegistrationOrigin::FeaturePack,
                owner_label: "producing".to_owned(),
                owner: Arc::new(ProducingOwner {
                    executions: executions.clone(),
                    descriptor_changed: descriptor_changed.clone(),
                }),
            })
            .unwrap();
        let resource = parse("ctrl://pack/note/item");

        assert!(matches!(
            registry
                .prepare_produce(
                    &context(),
                    &resource,
                    serde_json::json!({"kind": "unknown"})
                )
                .await,
            Err(ResourceError::UnsupportedOperation)
        ));
        assert_eq!(executions.load(Ordering::SeqCst), 0);

        let prepared = registry
            .prepare_produce(
                &context(),
                &resource,
                serde_json::json!({"kind": "replace", "content": "updated"}),
            )
            .await
            .unwrap();
        assert_eq!(executions.load(Ordering::SeqCst), 0);
        assert_eq!(
            prepared.execute(&context()).await.unwrap(),
            serde_json::json!({"kind": "replace", "content": "updated"})
        );
        assert_eq!(executions.load(Ordering::SeqCst), 1);

        let changed_prepared = registry
            .prepare_produce(
                &context(),
                &resource,
                serde_json::json!({"kind": "replace", "content": "blocked"}),
            )
            .await
            .unwrap();
        descriptor_changed.store(true, Ordering::SeqCst);
        assert!(matches!(
            changed_prepared.execute(&context()).await,
            Err(ResourceError::DescriptorChanged)
        ));
        assert_eq!(executions.load(Ordering::SeqCst), 1);

        descriptor_changed.store(false, Ordering::SeqCst);
        let invalid_result = registry
            .prepare_produce(
                &context(),
                &resource,
                serde_json::json!({"kind": "replace", "content": "invalid-result"}),
            )
            .await
            .unwrap();
        assert!(matches!(
            invalid_result.execute(&context()).await,
            Err(ResourceError::InvalidPayload { .. })
        ));
        assert_eq!(executions.load(Ordering::SeqCst), 2);
    }
}
