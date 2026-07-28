# syntax=docker/dockerfile:1
FROM curlimages/curl:8.12.1
COPY railway-heartbeat.sh /railway-heartbeat.sh
USER root
RUN chmod +x /railway-heartbeat.sh && sed -i 's/\r$//' /railway-heartbeat.sh
USER curl_user
ENTRYPOINT ["/bin/sh", "/railway-heartbeat.sh"]
