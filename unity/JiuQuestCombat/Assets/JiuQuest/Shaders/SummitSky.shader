Shader "JiuQuest/Summit Sky"
{
    Properties
    {
        [HideInInspector] _AmbientCloudOffset ("Playback cloud offset", Vector) = (0,0,0,0)
    }
    SubShader
    {
        Tags { "Queue"="Background" "RenderType"="Background" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Cull Front ZWrite Off ZTest LEqual
            HLSLPROGRAM
            #pragma vertex SkyVertex
            #pragma fragment SkyFragment
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            CBUFFER_START(UnityPerMaterial)
                float4 _AmbientCloudOffset;
            CBUFFER_END
            struct Attributes { float4 positionOS : POSITION; };
            struct Varyings { float4 positionCS : SV_POSITION; float3 positionWS : TEXCOORD0; };
            Varyings SkyVertex(Attributes input)
            {
                Varyings output;
                output.positionWS = TransformObjectToWorld(input.positionOS.xyz);
                output.positionCS = TransformWorldToHClip(output.positionWS);
                return output;
            }
            half4 SkyFragment(Varyings input) : SV_Target
            {
                float3 ray = normalize(input.positionWS - GetCameraPositionWS());
                float elevation = saturate(ray.y);
                // Share the renderer's actual fog color, including its color-space
                // conversion, so distant terrain merges into the horizon cleanly.
                half3 sky = lerp(unity_FogColor.rgb, half3(.035,.115,.225), pow(elevation, .52));
                // Supplied by the sampled combat clock, never shader wall time.
                float azimuth = atan2(ray.z, ray.x) + _AmbientCloudOffset.x;
                float streak = sin(elevation * 72 + sin(azimuth * 2) * 2.1 + _AmbientCloudOffset.y) * .5 + .5;
                float breakup = sin(azimuth * 5 + sin(azimuth * 3)) * .5 + .5;
                float cloudBand = smoothstep(.015,.05,elevation) * (1-smoothstep(.21,.38,elevation));
                float cloud = smoothstep(.40,.91,streak) * smoothstep(.14,.68,breakup) * cloudBand * .38;
                sky = lerp(sky, half3(.64,.68,.66), cloud);
                float sun = saturate(dot(ray, normalize(float3(-.40,.28,-.86))));
                sky += half3(.26,.14,.05) * pow(sun, 32);
                sky = lerp(sky, half3(1,.86,.60), smoothstep(.99935,.9998,sun));
                return half4(sky, 1);
            }
            ENDHLSL
        }
    }
    Fallback Off
}
