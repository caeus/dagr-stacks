FROM scratch

ARG STACK
ARG SOURCE
ARG REVISION

COPY ${STACK}/ /stack/
WORKDIR /stack

LABEL org.opencontainers.image.source=${SOURCE}
LABEL org.opencontainers.image.revision=${REVISION}
